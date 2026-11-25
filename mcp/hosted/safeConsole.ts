// Console output that can't carry a secret (#1505): js-lib logs whole AxiosErrors, whose config.headers hold
// the Homebase app token (bx0900), and the drive providers log note metadata; on the hosted server all of it
// would reach journald. So only strings (and numbers and booleans) are printed; anything else is its type name.

const describe = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Error) return `[${value.name}]`;
    if (typeof value === 'object' && value !== null) return `[${value.constructor?.name ?? 'object'}]`;
    return `[${typeof value}]`;
};

/** The console's printing methods over `write`, each line safe as above. */
export function safeConsole(write: (stream: 'stdout' | 'stderr', line: string) => void) {
    const to =
        (stream: 'stdout' | 'stderr') =>
        (...args: unknown[]) =>
            write(stream, args.map(describe).join(' '));
    return { log: to('stdout'), info: to('stdout'), debug: to('stdout'), warn: to('stderr'), error: to('stderr') };
}

export function installSafeConsole(): void {
    Object.assign(
        console,
        safeConsole((stream, line) => process[stream].write(`${line}\n`))
    );
}
