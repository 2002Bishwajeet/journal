// Generic OAuth-on-Node adapter: no Journal imports, so any MCP behind mcp-gateway can copy it.
// See the gateway docs (github.com/2002Bishwajeet/mcp-gateway, docs/ARCHITECTURE.md, "Per-MCP contract").
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector, setGlobalDispatcher } from 'undici';

// Every address a request from this server must never reach: this host, private networks, link-local
// (cloud metadata at 169.254.169.254), CGNAT, benchmarking, multicast and reserved ranges.
const blocked = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 3],
] as const) {
    blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
    // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d (::127.0.0.1).
    ['::', 96],
    ['fc00::', 7],
    ['fe80::', 10],
    // Deprecated site-local.
    ['fec0::', 10],
    ['ff00::', 8],
    // NAT64 and 6to4 carry an IPv4 address inside, private ones included.
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['2002::', 16],
] as const) {
    blocked.addSubnet(address, prefix, 'ipv6');
}

/** net.BlockList checks an IPv4-mapped IPv6 address (::ffff:7f00:1) against the IPv4 rules. */
export const isBlockedAddress = (ip: string) => blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function publicLookup(host: string, options: LookupOptions, done: LookupCallback): void {
    dnsLookup(host, { ...options, all: true }, (err, addresses) => {
        if (err) return done(err, []);
        const bad = addresses.find((entry) => isBlockedAddress(entry.address));
        if (bad) return done(new Error(`blocked non-public address ${bad.address} for ${host}`), []);
        if (options.all) return done(null, addresses);
        done(null, addresses[0].address, addresses[0].family);
    });
}

const connectPublic = buildConnector({ lookup: publicLookup as never });

/**
 * A dispatcher whose every connection, each redirect hop too, refuses a non-public address: IP literals
 * here (net skips `lookup` for them), host names on every DNS answer, so DNS rebinding can't get past it.
 */
export const publicOnlyAgent = new Agent({
    connect(options, callback) {
        const host = options.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && isBlockedAddress(host)) return callback(new Error(`blocked non-public address ${host}`), null);
        return connectPublic(options, callback);
    },
});

/**
 * Sends every fetch this process makes through `publicOnlyAgent` (Node's fetch uses undici's global
 * dispatcher). The server fetches only addresses others hand it: CIMD client ids, and the Homebase
 * identity a user types, so none of them can make it call into the box or its network.
 */
export function installPublicOnlyFetch(): void {
    setGlobalDispatcher(publicOnlyAgent);
}
