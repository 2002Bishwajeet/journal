import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown, ExternalLink, Info, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthorImage } from '@/components/author/AuthorImage';
import { useContact } from '@/hooks/useContact';
import { JOURNAL_APP_NAME } from '@/lib/homebase/config';
import { PERSON_EDITORS_SUPPORTED, type AccessEntry, type ShareRole } from '@/lib/share/shareAccess';
import type { ShareAccess } from '@/hooks/useShareAccess';
import { cn } from '@/lib/utils';

const members = (count: number | undefined) =>
    count === undefined ? '' : `${count} ${count === 1 ? 'member' : 'members'}`;

const PERSON_EDITOR_NOTE = 'Needs a Homebase server update';

/** A native select drawn like the app's Input (see AgentAccessSection's AccessSelect). */
function RoleSelect(props: ComponentProps<'select'>) {
    return (
        <div className="relative w-28 shrink-0">
            <select
                {...props}
                className="h-11 w-full appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-base text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 pointer-fine:text-sm"
            />
            <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
        </div>
    );
}

/** The Editor option, disabled for a person until person editors ship (#736). */
function EditorOption({ kind }: { kind: AccessEntry['kind'] }) {
    const disabled = kind === 'person' && !PERSON_EDITORS_SUPPORTED;
    return (
        <option value="editor" disabled={disabled}>
            {disabled ? `Editor (${PERSON_EDITOR_NOTE})` : 'Editor'}
        </option>
    );
}

function CircleIcon() {
    return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-collaborative/10 text-collaborative">
            <Users className="size-4" aria-hidden />
        </span>
    );
}

/** A connection's name from the contact drive, with the identity under it. */
function PersonLabel({ odinId }: { odinId: string }) {
    const displayName = useContact({ odinId, canSave: false }).fetch.data?.fileMetadata.appData.content.name?.displayName;
    return (
        <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{displayName || odinId}</span>
            {displayName && <span className="truncate text-xs text-muted-foreground">{odinId}</span>}
        </span>
    );
}

function AccessRow({ icon, label, children }: { icon: ReactNode; label: ReactNode; children: ReactNode }) {
    return (
        <li className="flex min-w-0 items-center gap-3 py-1.5">
            {icon}
            <span className="min-w-0 flex-1">{label}</span>
            {children}
        </li>
    );
}

interface SharePeopleSectionProps {
    access: ShareAccess;
    /** Set while Journal lacks the permissions sharing needs: where to grant them. */
    grantPermissionsUrl?: string;
    /** Why people can't be added at all (a note in a shared folder), shown instead of the picker. */
    disabledReason?: string;
}

/**
 * "People with access" (#682): one search over the owner's circles and connections with a
 * role picker, then the owner and everyone the note is shared with, each with a role menu.
 * Rendering only: the state and the saving live in {@link ShareAccess}.
 */
export function SharePeopleSection({ access, grantPermissionsUrl, disabledReason }: SharePeopleSectionProps) {
    const { entries, candidates, active, owner } = access;
    const listboxId = 'share-candidates';
    const optionId = (i: number) => `share-candidate-${i}`;
    const activeIndex = active ? candidates.indexOf(active) : -1;

    const onRoleChange = (entry: AccessEntry, value: string) => {
        if (value === 'remove') access.remove(entry);
        else access.setRole(entry, value as ShareRole);
    };

    return (
        <section aria-labelledby="share-people-heading" className="flex min-w-0 flex-col gap-3">
            <h3 id="share-people-heading" className="text-sm leading-5 font-medium">
                People with access
            </h3>

            {grantPermissionsUrl ? (
                <div className="flex flex-col gap-3">
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            {JOURNAL_APP_NAME} needs additional permissions to share notes with people.
                        </AlertDescription>
                    </Alert>
                    <Button asChild className="w-full max-sm:h-11">
                        <a
                            href={grantPermissionsUrl}
                            aria-label="Grant Permissions in Homebase (opens Homebase)"
                            className="flex items-center gap-2"
                        >
                            Grant Permissions <ExternalLink className="h-4 w-4" />
                        </a>
                    </Button>
                </div>
            ) : disabledReason ? (
                <p className="flex gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-pretty">
                    <Info className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    <span>{disabledReason}</span>
                </p>
            ) : (
                <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor="share-search">Add people or circles</Label>
                    <div className="flex min-w-0 gap-2">
                        <Input
                            id="share-search"
                            role="combobox"
                            aria-expanded={candidates.length > 0}
                            aria-controls={listboxId}
                            aria-autocomplete="list"
                            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                            aria-describedby={access.refusal ? 'share-search-refusal' : undefined}
                            value={access.query}
                            onChange={(e) => access.setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    const step = e.key === 'ArrowDown' ? 1 : -1;
                                    access.setActiveIndex((activeIndex + step + candidates.length) % Math.max(candidates.length, 1));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    access.add();
                                }
                            }}
                            placeholder="Search circles and connections"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            className="min-w-0 flex-1 max-sm:h-11"
                        />
                        <RoleSelect
                            aria-label="Role for people and circles you add"
                            value={access.role}
                            onChange={(e) => access.setPickedRole(e.target.value as ShareRole)}
                        >
                            <option value="viewer">Viewer</option>
                            <EditorOption kind={active?.kind ?? 'circle'} />
                        </RoleSelect>
                    </div>
                    {access.refusal && (
                        <p id="share-search-refusal" role="alert" className="text-xs text-destructive">
                            {access.refusal}
                        </p>
                    )}
                    {candidates.length > 0 && (
                        <ul id={listboxId} role="listbox" aria-label="Suggestions" className="flex max-h-56 flex-col overflow-y-auto rounded-md border p-1">
                            {candidates.map((c, i) => (
                                <li
                                    key={`${c.kind}:${c.id}`}
                                    id={optionId(i)}
                                    role="option"
                                    aria-selected={i === activeIndex}
                                    aria-disabled={!!c.disabledReason}
                                    // Keep focus in the field, so Enter and the arrows keep working
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => access.add(c)}
                                    onMouseEnter={() => access.setActiveIndex(i)}
                                    className={cn(
                                        'flex min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5',
                                        i === activeIndex && 'bg-accent',
                                        c.disabledReason && 'cursor-not-allowed opacity-50',
                                    )}
                                >
                                    {c.kind === 'circle' ? <CircleIcon /> : <AuthorImage odinId={c.id} className="size-8 shrink-0 rounded-full" />}
                                    <span className="min-w-0 flex-1">
                                        {c.kind === 'circle' ? (
                                            <span className="block truncate text-sm font-medium">{c.label}</span>
                                        ) : (
                                            <PersonLabel odinId={c.id} />
                                        )}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {c.disabledReason ?? (c.kind === 'circle' ? members(c.memberCount) : 'Person')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <ul aria-label="People with access" className="flex min-w-0 flex-col">
                <AccessRow icon={<AuthorImage odinId={owner} className="size-8 shrink-0 rounded-full" />} label={<PersonLabel odinId={owner} />}>
                    <span className="w-28 shrink-0 px-3 text-sm text-muted-foreground">Owner</span>
                </AccessRow>
                {entries.map((entry) => {
                    const circle = entry.kind === 'circle' ? access.circles.find((c) => c.id === entry.id) : undefined;
                    const name = entry.kind === 'circle' ? access.circleName(entry.id) : entry.id;
                    return (
                        <AccessRow
                            key={`${entry.kind}:${entry.id}`}
                            icon={entry.kind === 'circle' ? <CircleIcon /> : <AuthorImage odinId={entry.id} className="size-8 shrink-0 rounded-full" />}
                            label={entry.kind === 'circle' ? (
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium">{name}</span>
                                    <span className="truncate text-xs text-muted-foreground">{members(circle?.memberCount)}</span>
                                </span>
                            ) : (
                                <PersonLabel odinId={entry.id} />
                            )}
                        >
                            <RoleSelect
                                aria-label={`Role for ${name}`}
                                value={entry.role}
                                disabled={access.isSaving || !!disabledReason}
                                onChange={(e) => onRoleChange(entry, e.target.value)}
                            >
                                <option value="viewer">Viewer</option>
                                <EditorOption kind={entry.kind} />
                                <option value="remove">Remove</option>
                            </RoleSelect>
                        </AccessRow>
                    );
                })}
            </ul>
        </section>
    );
}
