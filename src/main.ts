// main.ts — Electron main process

import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs   from 'fs';
import { MAGIC, encrypt, decrypt, ENCRYPT_MAP } from './cipher';

let win: BrowserWindow;

// ── Window ─────────────────────────────────────────────────────────────────────

function createWindow(): void {
  win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  480,
    minHeight: 400,
    backgroundColor: '#FFFFFF',
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.loadFile(path.join(__dirname, '../index.html'));
  win.once('ready-to-show', () => win.show());
  buildMenu();
}

// ── Native menu ────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const send = (a: string) => win?.webContents.send('menu', a);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New',                      accelerator: 'CmdOrCtrl+N',       click: () => send('new')        },
        { label: 'Encrypt (open .txt)…',   accelerator: 'CmdOrCtrl+O', click: () => send('open-txt')   },
        { label: 'Decrypt (open .crypt)…', accelerator: 'CmdOrCtrl+D', click: () => send('open-crypt') },
        { type: 'separator' },
        { label: 'Save',                   accelerator: 'CmdOrCtrl+S',       click: () => send('save')    },
        { label: 'Save As…',               accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: 'Quit',                   accelerator: 'CmdOrCtrl+Q',       click: () => app.quit()      },
      ],
    },
    { label: 'Edit', role: 'editMenu' },
    {
      label: 'Encrypt',
      submenu: [
        { label: 'Decrypt & Open…', accelerator: 'CmdOrCtrl+D', click: () => send('open-crypt') },
        { type: 'separator' },
        { label: 'Cipher Key', click: () => send('cipher-key') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', click: () => send('toggle-sidebar') },
        { type: 'separator' },
        { label: 'Zoom In',    accelerator: 'CmdOrCtrl+Equal', click: () => send('zoom-in')    },
        { label: 'Zoom Out',   accelerator: 'CmdOrCtrl+-',     click: () => send('zoom-out')   },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0',     click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: 'DevTools', accelerator: 'CmdOrCtrl+Shift+I',
          click: () => win.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Cipher Reference', click: () => send('cipher-key') },
        { type: 'separator' },
        { label: 'About', click: () => send('about') },
      ],
    },
  ]));
}

// ── Recent files ───────────────────────────────────────────────────────────────

interface RecentEntry {
  path: string;
  name: string;
  kind: 'txt' | 'crypt';
  date: string;
}

function recentFile(): string {
  return path.join(app.getPath('userData'), 'cryptpad-recent.json');
}

function loadRecent(): RecentEntry[] {
  try {
    const p = recentFile();
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  } catch { return []; }
}

function saveRecent(entries: RecentEntry[]): void {
  try { fs.writeFileSync(recentFile(), JSON.stringify(entries, null, 2), 'utf8'); } catch {}
}

ipcMain.handle('recent:get', () => loadRecent());

ipcMain.handle('recent:add', (_e, entry: RecentEntry) => {
  const list = loadRecent().filter(e => e.path !== entry.path);
  list.unshift(entry);
  saveRecent(list.slice(0, 12));
});

ipcMain.handle('recent:remove', (_e, filePath: string) => {
  saveRecent(loadRecent().filter(e => e.path !== filePath));
});

// ── IPC: File open (multi-select) ─────────────────────────────────────────────

type FileResult = { path: string; content: string } | { path: string; error: string };

ipcMain.handle('file:open-txt', async (): Promise<FileResult[] | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Text File(s) to Encrypt',
    filters: [{ name: 'Text Files', extensions: ['txt'] },
              { name: 'All Files',  extensions: ['*']   }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths.map(fp => {
    try   { return { path: fp, content: fs.readFileSync(fp, 'utf8') }; }
    catch (e: any) { return { path: fp, error: e.message }; }
  });
});

ipcMain.handle('file:open-crypt', async (): Promise<FileResult[] | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Encrypted File(s) to Decrypt',
    filters: [{ name: 'CryptPad Files', extensions: ['crypt'] },
              { name: 'All Files',      extensions: ['*']     }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths.map(fp => {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (!raw.startsWith(MAGIC)) return { path: fp, error: 'Not a valid CryptPad file.' };
      return { path: fp, content: decrypt(raw.slice(MAGIC.length + 1)) };
    } catch (e: any) { return { path: fp, error: e.message }; }
  });
});

// ── IPC: File save ─────────────────────────────────────────────────────────────

ipcMain.handle('file:save-txt', (_e, filePath: string, content: string) => {
  try   { fs.writeFileSync(filePath, content, 'utf8'); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('file:save-crypt', (_e, filePath: string, content: string) => {
  try   { fs.writeFileSync(filePath, MAGIC + '\n' + encrypt(content), 'utf8'); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
});

ipcMain.handle('file:save-dialog', async (_e, opts: { defaultPath?: string; isCrypt: boolean }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title:       opts.isCrypt ? 'Save Encrypted File' : 'Save As',
    defaultPath: opts.defaultPath,
    filters: opts.isCrypt
      ? [{ name: 'CryptPad Files', extensions: ['crypt'] }]
      : [{ name: 'Text Files', extensions: ['txt'] },
         { name: 'CryptPad Files', extensions: ['crypt'] },
         { name: 'All Files', extensions: ['*'] }],
  });
  return canceled ? null : filePath;
});

ipcMain.handle('file:delete', (_e, filePath: string) => {
  try   { fs.unlinkSync(filePath); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
});

// Read file directly by path (for tree + recent file clicks, no dialog)
ipcMain.handle('file:read-direct', (_e, filePath: string, kind: 'txt' | 'crypt') => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (kind === 'crypt') {
      if (!raw.startsWith(MAGIC)) return { error: 'Not a valid CryptPad file.' };
      return { path: filePath, content: decrypt(raw.slice(MAGIC.length + 1)) };
    }
    return { path: filePath, content: raw };
  } catch (e: any) { return { error: e.message }; }
});

// ── IPC: Directory ─────────────────────────────────────────────────────────────

ipcMain.handle('dir:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Folder', properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

interface DirEntry { name: string; path: string; kind: 'dir'|'txt'|'crypt'|'other'; hasChildren: boolean; }

ipcMain.handle('dir:read', (_e, dirPath: string): DirEntry[] => {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      })
      .map(e => {
        const full = path.join(dirPath, e.name);
        if (e.isDirectory()) {
          let hasChildren = false;
          try { hasChildren = fs.readdirSync(full).some(n => !n.startsWith('.')); } catch {}
          return { name: e.name, path: full, kind: 'dir' as const, hasChildren };
        }
        const kind = e.name.endsWith('.crypt') ? 'crypt' : e.name.endsWith('.txt') ? 'txt' : 'other';
        return { name: e.name, path: full, kind: kind as DirEntry['kind'], hasChildren: false };
      });
  } catch { return []; }
});

// ── IPC: Dialogs / misc ────────────────────────────────────────────────────────

ipcMain.handle('cipher:map', () => ENCRYPT_MAP);

ipcMain.handle('dialog:confirm', async (_e, title: string, message: string) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title, message,
    buttons: ['Yes', 'No', 'Cancel'], defaultId: 0, cancelId: 2,
  });
  return response === 0 ? 'yes' : response === 1 ? 'no' : 'cancel';
});

ipcMain.handle('dialog:alert', async (_e, title: string, message: string) => {
  await dialog.showMessageBox(win, { type: 'info', title, message, buttons: ['OK'] });
});

ipcMain.handle('dialog:error', async (_e, title: string, message: string) => {
  await dialog.showErrorBox(title, message);
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
