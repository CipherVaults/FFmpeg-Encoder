# Read-only reveal investigation

## Official source finding
Electron's shell documentation describes selection as conditional. The version 44.7.0 Linux implementation prefers the desktop portal, then FileManager1. Failure can invoke OpenParentFolderFallback. That passes the file's parent to OpenFolder; OpenFolder launches xdg-open with "." and the supplied folder's parent as working directory. Therefore this fallback opens the original file's grandparent. This precisely matches the observed preparation directory, but the saved journal does not prove which backend executed.

Sources inspected:
- https://www.electronjs.org/docs/latest/api/shell
- https://raw.githubusercontent.com/electron/electron/v44.7.0/shell/common/platform_util_linux.cc (ShowItemHelper, lines 77–262; OpenFolder, lines 363–367)

This is a concrete conditional upstream explanation, not a proven attribution to Electron, Thunar, the portal or application code. The source was read, not compiled or executed.

## Local read-only observations
- inode/directory default resolves to thunar.desktop; its Exec is thunar %U.
- FileManager1 activation entry exists: org.xfce.Thunar.FileManager1.service, Name org.freedesktop.FileManager1, Exec /usr/bin/Thunar --gapplication-service.
- No portal Desktop entry was found by the narrow scan of /usr/share/dbus-1/services. That does not establish absence of a running or differently registered service.
- Installed xdg-open has an Xfce route through exo-open, otherwise gio open.
- Existing 084 stderr has missing system-bus and thumbnailer messages. Neither proves the session-bus reveal request failed.
- Native 082 used the same Electron version and app callback and was visibly successful. Different session backend availability is a hypothesis, not a measured difference. No before/after session-bus inventory exists.

## Small later diagnostic, separately authorized
Do not repeat encoding. Use a fresh owned harmless text marker inside a nested owned directory, with normal desktop security and the existing exact Electron binary. First review a tiny no-media diagnostic that records only a target hash/owned-relative label, exact binary identity and finite timing, then calls shell.showItemInFolder once. Keep full paths only in private local evidence.

Before this single visible call, read-only session-bus ListNames / NameHasOwner on the ACTUAL desktop session can establish current portal/FileManager presence without activating services. Never guess a bus address from the headless execution shell. A narrowly filtered, bounded session-bus observation for only the diagnostic sender and ShowItems/OpenDirectory (with private paths kept local) can distinguish those requests/replies from fallback. If unavailable, report that limitation rather than changing bus policy or installing tools.

Record the exact argument immediately before the shell call and whether the GUI opens/selects the intended file, its parent, or grandparent. A local owned-child observer limited to that diagnostic's child launches can record xdg-open argument "." and working-directory identity if fallback is spawned; no global process/environment scrape. Do not add this machinery unless the simple request/reply observation leaves a material ambiguity.

Stop after one call and normal close. No automatic retry, file-manager setting changes, service activation command, security flag, hidden UI action, install or media launch. A direct FileManager1 ShowItems comparison would be a second explicit bounded action, only if needed and separately released.

## Next engineering decision
If the exact target is recorded and fallback is proved, a narrow reviewed Linux fallback correction may be appropriate. Until then preserve native 084 as three successful publications with reveal location unresolved. Do not rewrite historical acceptance or delay checkpoint 085 on this exploratory study.
