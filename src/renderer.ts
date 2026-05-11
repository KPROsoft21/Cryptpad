// renderer.ts — CryptPad renderer process
// Two-page architecture: home-screen (standalone) ↔ workspace (toolbar+sidebar+editor)

// ── API types (injected by preload via contextBridge as window.api) ───────────
// NOTE: we use `capi` so the const name does not clash with the globally-scoped
// `window.api` property that contextBridge creates.

interface DirEntry    { name: string; path: string; kind: 'dir'|'txt'|'crypt'|'other'; hasChildren: boolean; }
interface RecentEntry { path: string; name: string; kind: 'txt'|'crypt'; date: string; }
type FileResult       = { path: string; content: string } | { path: string; error: string };
interface SaveResult  { ok: boolean; error?: string; }

interface CryptpadAPI {
  openTxt():   Promise<FileResult[]|null>;
  openCrypt(): Promise<FileResult[]|null>;
  saveTxt(p: string, c: string):   Promise<SaveResult>;
  saveCrypt(p: string, c: string): Promise<SaveResult>;
  saveDialog(o: { defaultPath?: string; isCrypt: boolean }): Promise<string|null>;
  deleteFile(p: string):           Promise<SaveResult>;
  readFileDirect(p: string, k: 'txt'|'crypt'): Promise<FileResult|null>;
  openDir():   Promise<string|null>;
  readDir(p: string): Promise<DirEntry[]>;
  getRecent(): Promise<RecentEntry[]>;
  addRecent(e: RecentEntry): Promise<void>;
  removeRecent(p: string):   Promise<void>;
  getCipherMap(): Promise<Record<string, string>>;
  confirm(t: string, m: string): Promise<'yes'|'no'|'cancel'>;
  alert(t: string, m: string):   Promise<void>;
  showError(t: string, m: string): Promise<void>;
  onMenu(cb: (action: string) => void): void;
}

// Access via a different name to avoid clash with the non-configurable global
// `api` property that contextBridge places on window.
const capi: CryptpadAPI = (window as any).api as CryptpadAPI;

// ── Cipher map (for modal display) ───────────────────────────────────────────

const ENCRYPT_MAP: Record<string, string> = {
  a:'\u2200', b:'\u2202', c:'\u2203', d:'\u0394', e:'\u2208',
  f:'\u2209', g:'\u2211', h:'\u220f', i:'\u222a', j:'\u2229',
  k:'\u222b', l:'\u2248', m:'\u2260', n:'\u2261', o:'\u2264',
  p:'\u2265', q:'\u2282', r:'\u2283', s:'\u2284', t:'\u2286',
  u:'\u2287', v:'\u2295', w:'\u2297', x:'\u22a5', y:'\u2207',
  z:'\u221a',
  A:'\u2191', B:'\u2193', C:'\u2190', D:'\u2192', E:'\u2194',
  F:'\u21d2', G:'\u21d4', H:'\u21d0', I:'\u21d1', J:'\u21d3',
  K:'\u21d5', L:'\u21d6', M:'\u21d7', N:'\u21d8', O:'\u21d9',
  P:'\u21da', Q:'\u21db', R:'\u21dc', S:'\u21dd', T:'\u21de',
  U:'\u21df', V:'\u21e0', W:'\u21e1', X:'\u21e2', Y:'\u21e3',
  Z:'\u21e4',
};

// ── Tab model ─────────────────────────────────────────────────────────────────

interface Tab {
  readonly id: string;
  filePath:    string | null;
  content:     string;
  isDirty:     boolean;
  isEncrypted: boolean;
}

let tabs:        Tab[]         = [];
let activeTabId: string | null = null;   // null = home screen shown
let fontSize:    number        = 16;
let sidebarOn:   boolean       = true;

// ── DOM refs ──────────────────────────────────────────────────────────────────

let homeScreen: HTMLDivElement;
let workspace:  HTMLDivElement;
let recentGrid: HTMLDivElement;
let editor:     HTMLTextAreaElement;
let lineNums:   HTMLDivElement;
let tabBar:     HTMLDivElement;
let tbName:     HTMLSpanElement;
let tbEncBadge: HTMLSpanElement;
let stMsg:      HTMLSpanElement;
let stMode:     HTMLSpanElement;
let stPos:      HTMLSpanElement;
let stTabs:     HTMLSpanElement;
let fileTree:   HTMLDivElement;
let sbPath:     HTMLDivElement;
let sidebar:    HTMLDivElement;
let resizer:    HTMLDivElement;
let modalBg:    HTMLDivElement;
let colLower:   HTMLDivElement;
let colUpper:   HTMLDivElement;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  function q<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

  homeScreen = q<HTMLDivElement>('home-screen');
  workspace  = q<HTMLDivElement>('workspace');
  recentGrid = q<HTMLDivElement>('recent-grid');
  editor     = q<HTMLTextAreaElement>('editor');
  lineNums   = q<HTMLDivElement>('line-nums');
  tabBar     = q<HTMLDivElement>('tab-bar');
  tbName     = q<HTMLSpanElement>('tb-name');
  tbEncBadge = q<HTMLSpanElement>('tb-enc-badge');
  stMsg      = q<HTMLSpanElement>('st-msg');
  stMode     = q<HTMLSpanElement>('st-mode');
  stPos      = q<HTMLSpanElement>('st-pos');
  stTabs     = q<HTMLSpanElement>('st-tabs');
  fileTree   = q<HTMLDivElement>('file-tree');
  sbPath     = q<HTMLDivElement>('sb-path');
  sidebar    = q<HTMLDivElement>('sidebar');
  resizer    = q<HTMLDivElement>('resizer');
  modalBg    = q<HTMLDivElement>('modal-bg');
  colLower   = q<HTMLDivElement>('col-lower');
  colUpper   = q<HTMLDivElement>('col-upper');

  bindHomeButtons();
  bindWorkspaceButtons();
  bindEditorEvents();
  bindKeyboard();
  bindMenu();
  bindModal();
  setupResizer();
  showHome();
});

// ── Page navigation ───────────────────────────────────────────────────────────

function showHome(): void {
  homeScreen.classList.remove('hidden');
  workspace.classList.add('hidden');
  document.title = 'CryptPad';
  loadHomeScreen();
}

function showWorkspace(): void {
  homeScreen.classList.add('hidden');
  workspace.classList.remove('hidden');
}

// ── Home-screen button bindings ───────────────────────────────────────────────

function bindHomeButtons(): void {
  const click = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener('click', fn);

  click('home-new',         () => newFile());
  click('home-encrypt',     () => doOpenTxt());
  click('home-decrypt',     () => doOpenCrypt());
  click('btn-clear-recent', () => clearRecent());
}

// ── Workspace toolbar bindings ────────────────────────────────────────────────

function bindWorkspaceButtons(): void {
  const click = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener('click', fn);

  click('tb-home',    () => goHome());
  click('tb-new',     () => newFile());
  click('tb-encrypt', () => doOpenTxt());
  click('tb-decrypt', () => doOpenCrypt());
  click('tb-save',    () => save());
  click('tb-zoom-in', () => zoomIn());
  click('tb-zoom-out',() => zoomOut());
  click('tb-key',     () => showCipherModal());
  click('tb-sidebar', () => toggleSidebar());
  click('sb-open',    () => browseDir());
}

// ── Menu events from main process ─────────────────────────────────────────────

function bindMenu(): void {
  capi.onMenu((action: string) => {
    const map: Record<string, () => void> = {
      'new':            () => newFile(),
      'open-txt':       () => doOpenTxt(),
      'open-crypt':     () => doOpenCrypt(),
      'save':           () => save(),
      'save-as':        () => saveAs(),
      'toggle-sidebar': () => toggleSidebar(),
      'zoom-in':        () => zoomIn(),
      'zoom-out':       () => zoomOut(),
      'zoom-reset':     () => zoomReset(),
      'cipher-key':     () => showCipherModal(),
      'about':          () => showAbout(),
    };
    map[action]?.();
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function bindKeyboard(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    if (e.key === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); return; }
    if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn();    return; }
    if (e.key === '-')                  { e.preventDefault(); zoomOut();   return; }
    if (e.key === '0')                  { e.preventDefault(); zoomReset(); return; }

    const map: Record<string, () => void> = {
      n: () => newFile(),
      o: () => doOpenTxt(),
      d: () => doOpenCrypt(),
      b: () => toggleSidebar(),
    };
    if (map[e.key.toLowerCase()]) { e.preventDefault(); map[e.key.toLowerCase()](); }
  });
}

// ── Editor events ─────────────────────────────────────────────────────────────

function bindEditorEvents(): void {
  editor.addEventListener('input', () => {
    const tab = activeFileTab();
    if (tab && !tab.isDirty) {
      tab.isDirty = true;
      renderTabBar();
      updateTitleAndBadge(tab);
    }
    syncLineNumbers();
    updateCursorPos();
  });

  editor.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(editor.selectionEnd);
      editor.selectionStart = editor.selectionEnd = s + 4;
      const tab = activeFileTab();
      if (tab && !tab.isDirty) { tab.isDirty = true; renderTabBar(); }
      syncLineNumbers();
    }
  });

  editor.addEventListener('click',  updateCursorPos);
  editor.addEventListener('keyup',  updateCursorPos);
  editor.addEventListener('scroll', syncLineNumbers);
}

// ── Tab management ────────────────────────────────────────────────────────────

function activeFileTab(): Tab | null {
  if (!activeTabId) return null;
  return tabs.find(t => t.id === activeTabId) ?? null;
}

function flushEditor(): void {
  const tab = activeFileTab();
  if (tab) tab.content = editor.value;
}

function switchToTab(id: string): void {
  flushEditor();
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) { goHome(); return; }

  showWorkspace();
  editor.value = tab.content;
  syncLineNumbers();
  updateCursorPos();
  updateTitleAndBadge(tab);
  setStatus(tab.filePath
    ? (tab.isEncrypted ? 'Decrypted: ' : 'Opened: ') + tabName(tab)
    : 'New file');
  renderTabBar();
  editor.focus();
}

function goHome(): void {
  flushEditor();
  activeTabId = null;
  showHome();
}

function openInTab(filePath: string | null, content: string, encrypted: boolean): Tab {
  if (filePath) {
    const existing = tabs.find(t => t.filePath === filePath);
    if (existing) { switchToTab(existing.id); return existing; }
  }
  const id  = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tab: Tab = { id, filePath, content, isDirty: false, isEncrypted: encrypted };
  tabs.push(tab);
  switchToTab(id);
  return tab;
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  if (tab.isDirty) {
    const ans = await capi.confirm('Close Tab',
      `"${tabName(tab)}" has unsaved changes.\nClose anyway?`);
    if (ans !== 'yes') return;
  }

  tabs = tabs.filter(t => t.id !== id);
  if (activeTabId === id) {
    tabs.length ? switchToTab(tabs[tabs.length - 1].id) : goHome();
  } else {
    renderTabBar();
  }
}

function tabName(tab: Tab): string {
  return tab.filePath ? tab.filePath.split('/').pop()! : 'Untitled';
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function renderTabBar(): void {
  if (!tabs.length) { tabBar.innerHTML = ''; stTabs.textContent = ''; return; }

  tabBar.innerHTML = tabs.map(tab => {
    const active = tab.id === activeTabId;
    const name   = escapeHtml(tabName(tab));
    const enc    = tab.isEncrypted ? `<span class="tab-enc">[ENC]</span>` : '';
    const dirty  = tab.isDirty     ? `<span class="tab-dirty">\u25cf</span>` : '';
    return (
      `<div class="tab${active ? ' active' : ''}" data-tab-id="${tab.id}">`
      + enc
      + `<span class="tab-name">${name}</span>`
      + dirty
      + `<button class="tab-x" data-close-id="${tab.id}" title="Close">&#x2715;</button>`
      + `</div>`
    );
  }).join('');

  tabBar.querySelectorAll<HTMLElement>('.tab').forEach(el => {
    el.addEventListener('click', (e) => {
      const closeBtn = (e.target as HTMLElement).closest('.tab-x') as HTMLElement | null;
      if (closeBtn) {
        e.stopPropagation();
        closeTab(closeBtn.dataset.closeId!);
        return;
      }
      const id = el.dataset.tabId!;
      if (id !== activeTabId) switchToTab(id);
    });
  });

  stTabs.textContent = `${tabs.length} file${tabs.length > 1 ? 's' : ''} open`;
}

// ── Toolbar title + badge ─────────────────────────────────────────────────────

function updateTitleAndBadge(tab: Tab): void {
  const name = tabName(tab);
  tbName.textContent = tab.filePath ? name : '';
  tbEncBadge.classList.toggle('hidden', !tab.isEncrypted);
  setMode(tab.isEncrypted ? 'Encrypted (.crypt)' : 'Plain Text');
  document.title = `${tab.isDirty ? '\u2022 ' : ''}${name} \u2014 CryptPad`;
}

// ── File operations ───────────────────────────────────────────────────────────

async function newFile(): Promise<void> {
  openInTab(null, '', false);
  setStatus('New file');
}

async function doOpenTxt(): Promise<void> {
  const results = await capi.openTxt();
  if (!results) return;
  for (const r of results) {
    if ('error' in r) { await capi.showError('Open Error', r.error); continue; }
    openInTab(r.path, r.content, false);
    await capi.addRecent({ path: r.path, name: r.path.split('/').pop()!, kind: 'txt', date: new Date().toISOString() });
  }
}

async function doOpenCrypt(): Promise<void> {
  const results = await capi.openCrypt();
  if (!results) return;
  for (const r of results) {
    if ('error' in r) { await capi.showError('Decrypt Error', r.error); continue; }
    openInTab(r.path, r.content, true);
    await capi.addRecent({ path: r.path, name: r.path.split('/').pop()!, kind: 'crypt', date: new Date().toISOString() });
  }
}

async function save(): Promise<void> {
  const tab = activeFileTab();
  if (!tab) return;

  if (!tab.filePath) {
    // New file — ask where to save (always as .crypt)
    await saveAs();
    return;
  }

  // Derive the .crypt path: if opened from a .txt, swap the extension
  const cryptPath = tab.filePath.endsWith('.crypt')
    ? tab.filePath
    : tab.filePath.replace(/\.[^./\\]+$/, '') + '.crypt';

  await writeCrypt(tab, cryptPath);
}

async function saveAs(): Promise<void> {
  const tab = activeFileTab();
  if (!tab) return;
  // Suggest the .crypt path as default
  const defaultPath = tab.filePath
    ? tab.filePath.replace(/\.[^./\\]+$/, '') + '.crypt'
    : undefined;
  const chosen = await capi.saveDialog({ defaultPath, isCrypt: true });
  if (!chosen) return;
  await writeCrypt(tab, chosen);
}

// ── Write helper ──────────────────────────────────────────────────────────────

async function writeCrypt(tab: Tab, filePath: string): Promise<void> {
  // Always read from the live editor — tab.content may be stale if the user
  // typed since the last tab switch.
  const content = editor.value;
  const res = await capi.saveCrypt(filePath, content);
  if (!res.ok) { await capi.showError('Save Error', res.error ?? 'Unknown error'); return; }
  tab.content     = content;   // keep in sync
  tab.filePath    = filePath;
  tab.isEncrypted = true;
  tab.isDirty     = false;
  renderTabBar();
  updateTitleAndBadge(tab);
  setStatus('Saved: ' + tabName(tab));
  await capi.addRecent({ path: filePath, name: tabName(tab), kind: 'crypt', date: new Date().toISOString() });
}

// ── Home screen ───────────────────────────────────────────────────────────────

async function loadHomeScreen(): Promise<void> {
  renderRecent(await capi.getRecent());
}

function renderRecent(files: RecentEntry[]): void {
  if (!files.length) {
    recentGrid.innerHTML = '<div class="no-recent">No recent files yet \u2014 open or create a file to get started</div>';
    return;
  }

  recentGrid.innerHTML = files.map(f => {
    const d       = new Date(f.date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const parts   = f.path.split('/');
    const parent  = parts.slice(0, -1).join('/');
    const short   = parent.length > 38 ? '\u2026' + parent.slice(-35) : parent;
    return (
      `<div class="recent-card" data-path="${escapeHtml(f.path)}" data-kind="${f.kind}">`
      + `<span class="recent-badge">${f.kind === 'crypt' ? 'ENC' : 'TXT'}</span>`
      + `<div class="recent-name">${escapeHtml(f.name)}</div>`
      + `<div class="recent-path">${escapeHtml(short)}</div>`
      + `<div class="recent-date">${dateStr}</div>`
      + `<button class="recent-rm" data-rm-path="${escapeHtml(f.path)}" title="Remove from list">&#x2715;</button>`
      + `</div>`
    );
  }).join('');

  recentGrid.querySelectorAll<HTMLElement>('.recent-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.recent-rm')) return;
      const filePath = card.dataset.path!;
      const kind     = card.dataset.kind as 'txt'|'crypt';
      const result   = await capi.readFileDirect(filePath, kind);
      if (!result) return;
      if ('error' in result) {
        await capi.removeRecent(filePath);
        await loadHomeScreen();
        await capi.showError('Open Error', `Could not open file:\n${result.error}`);
        return;
      }
      openInTab(result.path, result.content, kind === 'crypt');
      await capi.addRecent({ path: result.path, name: result.path.split('/').pop()!, kind, date: new Date().toISOString() });
    });
  });

  recentGrid.querySelectorAll<HTMLElement>('.recent-rm').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await capi.removeRecent(btn.dataset.rmPath!);
      await loadHomeScreen();
    });
  });
}

async function clearRecent(): Promise<void> {
  const ans = await capi.confirm('Clear Recent Files', 'Remove all recent file entries?');
  if (ans !== 'yes') return;
  for (const f of await capi.getRecent()) await capi.removeRecent(f.path);
  renderRecent([]);
}

// ── Sidebar / file tree ───────────────────────────────────────────────────────

async function browseDir(): Promise<void> {
  const dir = await capi.openDir();
  if (dir) await loadDir(dir);
}

async function loadDir(dir: string): Promise<void> {
  const short = dir.length > 30 ? '\u2026' + dir.slice(-27) : dir;
  sbPath.textContent = short;
  sbPath.title       = dir;
  fileTree.innerHTML = '';
  renderEntries(await capi.readDir(dir), fileTree);
}

function renderEntries(entries: DirEntry[], container: HTMLElement): void {
  for (const e of entries) {
    const row = document.createElement('div');
    row.className    = 'tree-row';
    row.dataset.path = e.path;
    row.dataset.kind = e.kind;

    const icon       = e.kind === 'dir' ? '\u25b6' : e.kind === 'crypt' ? '\u25c8' : e.kind === 'txt' ? '\u25a1' : '\u00b7';
    const klass      = `kind-${e.kind}`;
    const showToggle = e.kind === 'dir' && e.hasChildren;

    row.innerHTML =
      `<span class="tree-toggle" style="visibility:${showToggle ? 'visible' : 'hidden'}">\u25b6</span>`
    + `<span class="tree-icon ${klass}">${icon}</span>`
    + `<span class="tree-label ${klass}">${escapeHtml(e.name)}</span>`;

    container.appendChild(row);

    if (e.kind === 'dir') {
      const childDiv = document.createElement('div');
      childDiv.className     = 'tree-children';
      childDiv.style.display = 'none';
      container.appendChild(childDiv);

      const toggle = row.querySelector('.tree-toggle') as HTMLElement;
      row.addEventListener('click', async () => {
        const open = childDiv.style.display !== 'none';
        if (open) { childDiv.style.display = 'none'; toggle.classList.remove('open'); }
        else {
          if (!childDiv.children.length) renderEntries(await capi.readDir(e.path), childDiv);
          childDiv.style.display = ''; toggle.classList.add('open');
        }
      });
    } else if (e.kind === 'txt' || e.kind === 'crypt') {
      row.addEventListener('click', () => openFromTree(e));
    }
  }
}

async function openFromTree(entry: DirEntry): Promise<void> {
  fileTree.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
  fileTree.querySelectorAll<HTMLElement>('.tree-row')
    .forEach(r => { if (r.dataset.path === entry.path) r.classList.add('selected'); });

  const kind: 'txt'|'crypt' = entry.kind === 'crypt' ? 'crypt' : 'txt';
  const result = await capi.readFileDirect(entry.path, kind);
  if (!result) return;
  if ('error' in result) { await capi.showError('Open Error', result.error); return; }
  openInTab(result.path, result.content, kind === 'crypt');
  await capi.addRecent({ path: result.path, name: result.path.split('/').pop()!, kind, date: new Date().toISOString() });
}

// ── Sidebar toggle ────────────────────────────────────────────────────────────

function toggleSidebar(): void {
  sidebarOn = !sidebarOn;
  const show = sidebarOn && window.innerWidth > 580;
  sidebar.style.display = show ? '' : 'none';
  resizer.style.display = show ? '' : 'none';
}

// ── Line numbers ──────────────────────────────────────────────────────────────

function syncLineNumbers(): void {
  const n    = (editor.value.match(/\n/g) ?? []).length + 1;
  const text = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  if (lineNums.textContent !== text) lineNums.textContent = text;
  lineNums.style.fontSize = `${fontSize}px`;
  lineNums.scrollTop      = editor.scrollTop;
}

// ── Cursor / status helpers ───────────────────────────────────────────────────

function updateCursorPos(): void {
  const val  = editor.value.slice(0, editor.selectionStart);
  const line = val.split('\n').length;
  const col  = val.split('\n').pop()!.length + 1;
  stPos.textContent = `Ln ${line}, Col ${col}`;
}

function setStatus(msg: string): void { stMsg.textContent  = msg; }
function setMode(mode: string): void  { stMode.textContent = mode; }

// ── Zoom ──────────────────────────────────────────────────────────────────────

function zoomIn():    void { applyFontSize(Math.min(fontSize + 2, 36)); }
function zoomOut():   void { applyFontSize(Math.max(fontSize - 2, 10)); }
function zoomReset(): void { applyFontSize(16); }

function applyFontSize(n: number): void {
  fontSize = n;
  editor.style.fontSize = `${n}px`;
  syncLineNumbers();
  setStatus(`Zoom: ${n}px`);
}

// ── Cipher modal ──────────────────────────────────────────────────────────────

function showCipherModal(): void {
  if (!colLower.children.length) buildCipherTable();
  modalBg.classList.remove('hidden');
  document.getElementById('modal-ok')?.focus();
}

function hideCipherModal(): void {
  modalBg.classList.add('hidden');
  if (activeTabId) editor.focus();
}

function buildCipherTable(): void {
  const fill = (el: HTMLElement, title: string, chars: string) => {
    const h = document.createElement('h3');
    h.textContent = title;
    el.appendChild(h);
    for (const ch of chars) {
      const row = document.createElement('div');
      row.className = 'cipher-row';
      row.innerHTML =
        `<span class="cipher-letter">${escapeHtml(ch)}</span>`
      + `<span class="cipher-arrow">\u2192</span>`
      + `<span class="cipher-sym">${ENCRYPT_MAP[ch] ?? '?'}</span>`;
      el.appendChild(row);
    }
  };
  fill(colLower, 'Lowercase  a \u2013 z', 'abcdefghijklmnopqrstuvwxyz');
  fill(colUpper, 'Uppercase  A \u2013 Z', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
}

function bindModal(): void {
  document.getElementById('modal-x')?.addEventListener('click',  hideCipherModal);
  document.getElementById('modal-ok')?.addEventListener('click', hideCipherModal);
  modalBg.addEventListener('click', e => { if (e.target === modalBg) hideCipherModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modalBg.classList.contains('hidden')) hideCipherModal();
  });
}

// ── About ─────────────────────────────────────────────────────────────────────

async function showAbout(): Promise<void> {
  await capi.alert('About CryptPad', [
    'CryptPad  v2.0  \u2014  TypeScript + Electron',
    '\u2500'.repeat(42),
    '',
    'Secure text editor with symbolic substitution cipher.',
    '',
    'Features:',
    '  \u2022 Multi-tab: open multiple files simultaneously',
    '  \u2022 Recent files home screen',
    '  \u2022 Encrypt: open .txt \u2192 save as .crypt',
    '  \u2022 Decrypt: open .crypt \u2192 edit as plain text',
    '  \u2022 Resizable, responsive layout',
    '',
    'Cipher:  a\u2013z \u2192 math symbols (\u2200 \u2202 \u2203 \u2026)',
    '         A\u2013Z \u2192 arrow symbols (\u2191 \u2193 \u2190 \u2026)',
    '',
    'Numbers, spaces, punctuation pass through unchanged.',
    '.crypt files open and decrypt only in CryptPad.',
  ].join('\n'));
}

// ── Sidebar resizer ───────────────────────────────────────────────────────────

function setupResizer(): void {
  let active = false, startX = 0, startW = 0;

  resizer.addEventListener('mousedown', (e: MouseEvent) => {
    active = true; startX = e.clientX; startW = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!active) return;
    sidebar.style.width = `${Math.max(140, Math.min(400, startW + (e.clientX - startX)))}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
