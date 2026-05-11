// preload.ts — secure contextBridge between main and renderer

import { contextBridge, ipcRenderer } from 'electron';

export interface DirEntry {
  name: string; path: string;
  kind: 'dir' | 'txt' | 'crypt' | 'other';
  hasChildren: boolean;
}

export interface RecentEntry {
  path: string;
  name: string;
  kind: 'txt' | 'crypt';
  date: string;
}

export type FileResult = { path: string; content: string } | { path: string; error: string };

export interface SaveResult { ok: boolean; error?: string; }

export interface CryptpadAPI {
  // Multi-file open dialogs
  openTxt():              Promise<FileResult[] | null>;
  openCrypt():            Promise<FileResult[] | null>;
  // Save
  saveTxt(p: string, c: string):   Promise<SaveResult>;
  saveCrypt(p: string, c: string): Promise<SaveResult>;
  saveDialog(opts: { defaultPath?: string; isCrypt: boolean }): Promise<string | null>;
  deleteFile(p: string):           Promise<SaveResult>;
  // Direct path read (tree + recent clicks)
  readFileDirect(p: string, kind: 'txt' | 'crypt'): Promise<FileResult | null>;
  // Directory
  openDir():                       Promise<string | null>;
  readDir(p: string):              Promise<DirEntry[]>;
  // Recent files
  getRecent():                     Promise<RecentEntry[]>;
  addRecent(e: RecentEntry):       Promise<void>;
  removeRecent(p: string):         Promise<void>;
  // Misc
  getCipherMap():                  Promise<Record<string, string>>;
  confirm(t: string, m: string):   Promise<'yes' | 'no' | 'cancel'>;
  alert(t: string, m: string):     Promise<void>;
  showError(t: string, m: string): Promise<void>;
  onMenu(cb: (action: string) => void): void;
}

const api: CryptpadAPI = {
  openTxt:        ()       => ipcRenderer.invoke('file:open-txt'),
  openCrypt:      ()       => ipcRenderer.invoke('file:open-crypt'),
  saveTxt:        (p, c)   => ipcRenderer.invoke('file:save-txt', p, c),
  saveCrypt:      (p, c)   => ipcRenderer.invoke('file:save-crypt', p, c),
  saveDialog:     (opts)   => ipcRenderer.invoke('file:save-dialog', opts),
  deleteFile:     (p)      => ipcRenderer.invoke('file:delete', p),
  readFileDirect: (p, k)   => ipcRenderer.invoke('file:read-direct', p, k),
  openDir:        ()       => ipcRenderer.invoke('dir:open'),
  readDir:        (p)      => ipcRenderer.invoke('dir:read', p),
  getRecent:      ()       => ipcRenderer.invoke('recent:get'),
  addRecent:      (e)      => ipcRenderer.invoke('recent:add', e),
  removeRecent:   (p)      => ipcRenderer.invoke('recent:remove', p),
  getCipherMap:   ()       => ipcRenderer.invoke('cipher:map'),
  confirm:        (t, m)   => ipcRenderer.invoke('dialog:confirm', t, m),
  alert:          (t, m)   => ipcRenderer.invoke('dialog:alert', t, m),
  showError:      (t, m)   => ipcRenderer.invoke('dialog:error', t, m),
  onMenu: (cb) => { ipcRenderer.on('menu', (_e, a: string) => cb(a)); },
};

contextBridge.exposeInMainWorld('api', api);
