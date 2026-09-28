/**
 * Minimal in-memory mock of the Google Apps Script runtime.
 *
 * Lets `code.gs` be executed under Node (via `vm`) so the whole API surface can
 * be exercised end-to-end without touching a real spreadsheet or Drive:
 *   SpreadsheetApp / DriveApp / MailApp / Utilities / PropertiesService /
 *   ScriptApp / HtmlService / ContentService / Logger
 *
 * This is a test double only — it is never deployed to Apps Script.
 */
'use strict';

const crypto = require('crypto');

function createStub() {
  // ---------------------------------------------------------------- state
  const state = {
    sheets: new Map(),   // sheetName -> Sheet
    files: new Map(),    // fileId    -> File
    folders: new Map(),  // folderId  -> Folder
    mailbox: [],         // {to, subject, body}
    props: {},           // script properties
    fetches: [],         // {url, options} — outbound UrlFetchApp traffic
    fetchResponder: null, // (url, options) => object|null — mocked JSON responses
    seq: 0,
  };

  const nextId = (p) => p + '-' + (++state.seq);

  // ------------------------------------------------------------ Spreadsheet
  class Range {
    constructor(sheet, row, col) { this.sheet = sheet; this.row = row; this.col = col; }
    getValue() {
      const r = this.sheet.rows[this.row - 1] || [];
      return r[this.col - 1];
    }
    setValue(v) {
      while (this.sheet.rows.length < this.row) this.sheet.rows.push([]);
      const r = this.sheet.rows[this.row - 1];
      while (r.length < this.col) r.push('');
      r[this.col - 1] = v;
      return this;
    }
  }

  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
    appendRow(arr) { this.rows.push(arr.slice()); }
    deleteRow(row) {
      if (row >= 1 && row <= this.rows.length) this.rows.splice(row - 1, 1);
      return this;
    }
    clear() { this.rows = []; return this; }
    setFrozenRows(n) { this.frozen = n; return this; }
    getDataRange() {
      const self = this;
      return { getValues: () => self.rows.map((r) => r.slice()) };
    }
    getRange(row, col) { return new Range(this, row, col); }
  }

  class Spreadsheet {
    constructor() { this.sheetOrder = []; }
    getSheetByName(name) { return state.sheets.get(name) || null; }
    insertSheet(name) {
      const sh = new Sheet(name);
      state.sheets.set(name, sh);
      this.sheetOrder.push(name);
      return sh;
    }
  }

  const spreadsheet = new Spreadsheet();

  const SpreadsheetApp = {
    openById() { return spreadsheet; },
    getActiveSpreadsheet() { return spreadsheet; },
  };

  // ------------------------------------------------------------------ Drive
  class File {
    constructor(id, name, bytes, type) {
      this.id = id; this.name = name; this.bytes = bytes || []; this.type = type || '';
      this.parents = []; this.sharing = null;
      state.files.set(id, this);
    }
    getId() { return this.id; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
    getBlob() {
      return {
        getName: () => this.name,
        getBytes: () => this.bytes,
        getContentType: () => this.type || 'application/octet-stream',
      };
    }
    setSharing(access, permission) {
      this.sharing = { access, permission };
      return this;
    }
    getParents() {
      const list = this.parents.map((id) => state.folders.get(id)).filter(Boolean);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    // convenience for tests
    parentIds() { return this.parents.slice(); }
  }

  class Folder {
    constructor(id, name) {
      this.id = id; this.name = name; this.fileIds = [];
      state.folders.set(id, this);
    }
    getId() { return this.id; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    createFile(blob) {
      const type = blob.getContentType ? blob.getContentType() : '';
      const f = new File(nextId('file'), blob.getName(), blob.getBytes().slice(), type);
      this.fileIds.push(f.id);
      f.parents.push(this.id);
      return f;
    }
    addFile(file) {
      if (this.fileIds.indexOf(file.id) === -1) this.fileIds.push(file.id);
      if (file.parents.indexOf(this.id) === -1) file.parents.push(this.id);
      return this;
    }
    removeFile(file) {
      this.fileIds = this.fileIds.filter((id) => id !== file.id);
      file.parents = file.parents.filter((id) => id !== this.id);
      return this;
    }
    getFiles() {
      const list = this.fileIds.map((id) => state.files.get(id)).filter(Boolean);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    getFoldersByName(name) {
      const list = [...state.folders.values()].filter((f) => f.name === name);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    createFolder(name) { return new Folder(nextId('folder'), name); }
    fileNames() { return this.fileIds.map((id) => state.files.get(id).name); }
  }

  // Pre-create the Drive folders configured in code.gs plus root.
  const ROOT = new Folder('root', 'My Drive');
  const PENDING = new Folder('1kF3WC5GytedlY3_Qtzz5Hq4iwzAiHpul', 'Pending Rx');
  const APPROVED = new Folder('17ltgph31bn2qdll3esDRvxT9LXstB3TQ', 'Approved Rx');
  const DECLINED = new Folder('1EQhvrSVxtWRZbCqjrCX2M7kUCC4mH0f5', 'Declined Rx');
  const MERCHANT_DOCS = new Folder('1InwS_7yCGWxrLZZC5Xa95sjm-TgGuolm', 'Merchant KYC Docs');

  const DriveApp = {
    Access: {
      ANYONE_WITH_LINK: 'ANYONE_WITH_LINK',
      DOMAIN_RESTRICTED: 'DOMAIN_RESTRICTED',
      PRIVATE: 'PRIVATE',
      ANYONE: 'ANYONE',
    },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', NONE: 'NONE' },
    getRootFolder: () => ROOT,
    getFolderById(id) {
      const f = state.folders.get(id);
      if (!f) throw new Error('Mock DriveApp: no folder with id ' + id);
      return f;
    },
    getFileById(id) {
      const f = state.files.get(id);
      if (!f) throw new Error('Mock DriveApp: no file with id ' + id);
      return f;
    },
    createFolder(name) {
      const f = ROOT.createFolder(name);
      return f;
    },
  };

  // ------------------------------------------------------------------- Mail
  const MailApp = {
    _fail: false,
    sendEmail(msg) {
      if (MailApp._fail) throw new Error('Mail quota exceeded (mock)');
      state.mailbox.push(msg);
    },
    getRemainingDailyQuota() { return 100; },
  };

  // -------------------------------------------------------------- Utilities
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5' },
    base64Decode: (s) => [...Buffer.from(String(s), 'base64')],
    base64Encode: (b) => Buffer.from(b).toString('base64'),
    newBlob(bytes, type, name) {
      const arr = Array.from(bytes || []);
      return {
        getBytes: () => arr,
        getName: () => name,
        getContentType: () => type,
        setSharing() { return this; },
      };
    },
    computeDigest(alg, value) {
      const map = { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5' };
      return [...crypto.createHash(map[alg] || 'sha256').update(String(value)).digest()];
    },
    computeHmacSha256Signature(value, key) {
      return [...crypto.createHmac('sha256', String(key)).update(String(value)).digest()];
    },
    getUuid: () => crypto.randomUUID(),
    sleep() {},
    formatDate(d, tz, fmt) {
      return fmt === 'yyyy' ? new Intl.DateTimeFormat('en-US', { timeZone:tz, year:'numeric' }).format(d) : String(d);
    },
  };

  // -------------------------------------------------------------- Properties
  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty: (k) => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        deleteProperty: (k) => { delete state.props[k]; },
        getProperties: () => Object.assign({}, state.props),
      };
    },
    getUserProperties() { return PropertiesService.getScriptProperties(); },
  };

  // ------------------------------------------------------- Script / Html / CS
  const ScriptApp = {
    getService() {
      return { getUrl: () => 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec' };
    },
  };

  const HtmlService = {
    createHtmlOutput(html) {
      return {
        _html: String(html),
        getContent() { return this._html; },
        setTitle() { return this; },
        setXFrameOptionsMode() { return this; },
        setSandboxMode() { return this; },
      };
    },
    createTemplateFromFile() { throw new Error('not mocked'); },
    SandboxMode: { IFRAME: 'IFRAME' },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
  };

  class TextOutput {
    constructor(content) { this._content = String(content); this._mime = 'TEXT'; }
    setMimeType(m) { this._mime = m; return this; }
    getMimeType() { return this._mime; }
    append(s) { this._content += String(s); return this; }
    setContent(s) { this._content = String(s); return this; }
    getContent() { return this._content; }
  }

  const ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT', JAVASCRIPT: 'JAVASCRIPT' },
    createTextOutput(content) { return new TextOutput(content); },
  };

  const LockService = {
    getScriptLock() {
      return { tryLock: () => true, releaseLock: () => {} };
    },
  };

  const Session = {
    getScriptTimeZone: () => 'Asia/Kolkata',
    getActiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
  };

  const Logger = { log: () => {}, clear: () => {} };

  // ------------------------------------------------------------- UrlFetchApp
  // Social sign-in verification (Google tokeninfo) happens
  // server-side in code.gs. Tests and the demo install state.fetchResponder to
  // answer those calls; without a responder every request 404s.
  const UrlFetchApp = {
    fetch(url, options) {
      const record = { url: String(url), options: options || {} };
      state.fetches.push(record);
      let body = null;
      if (state.fetchResponder) {
        try { body = state.fetchResponder(record.url, record.options); } catch (err) { body = null; }
      }
      return {
        getResponseCode: () => (body ? 200 : 404),
        getContentText: () => (body ? JSON.stringify(body) : '{}'),
      };
    },
  };

  // ------------------------------------------------------------- test helpers
  const helpers = {
    /** base64 of a string, so specs do not need Buffer inside the vm. */
    b64: (s) => Buffer.from(String(s)).toString('base64'),
    /** Build the event object an Apps Script doPost() receives. */
    postEvent(payload) {
      return {
        postData: { type: 'text/plain', contents: JSON.stringify(payload) },
        parameter: {},
        parameters: {},
      };
    },
    /** Build the event object for an HTML form POST (urlencoded body). */
    formEvent(fields) {
      const body = Object.keys(fields)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]))
        .join('&');
      const parameter = {};
      Object.keys(fields).forEach((k) => { parameter[k] = String(fields[k]); });
      return {
        postData: { type: 'application/x-www-form-urlencoded', contents: body },
        parameter,
        parameters: Object.fromEntries(Object.entries(parameter).map(([k, v]) => [k, [v]])),
      };
    },
    getEvent(parameter) { return { parameter: parameter || {}, parameters: {} }; },
    /** Parse a ContentService response into {success, message, data}. */
    json(output) {
      if (!output) return null;
      if (typeof output.getContent === 'function') {
        try { return JSON.parse(output.getContent()); } catch (e) { return null; }
      }
      return output;
    },
    /** Last email sent to `to`, or null. */
    lastMail(to) {
      const list = to ? state.mailbox.filter((m) => m.to === to) : state.mailbox;
      return list.length ? list[list.length - 1] : null;
    },
    /** Pull the 6-digit OTP out of the body of the last mail to `to`. */
    lastOtp(to) {
      const m = helpers.lastMail(to);
      if (!m) return null;
      const match = String(m.body).match(/\b(\d{6})\b/);
      return match ? match[1] : null;
    },
    /** Pull the reset token out of the link in the last mail to `to`. */
    lastResetToken(to) {
      const m = helpers.lastMail(to);
      if (!m) return null;
      const match = String(m.body).match(/token=([A-Za-z0-9-]+)/);
      return match ? match[1] : null;
    },
    sheet(name) { return state.sheets.get(name); },
    sheetRows(name) { return (state.sheets.get(name) || { rows: [] }).rows; },
    /** Find a row (array) by value in a given 0-based column. */
    findRow(name, col, value) {
      const rows = helpers.sheetRows(name);
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][col]) === String(value)) return rows[i];
      }
      return null;
    },
    fileById: (id) => state.files.get(id),
    folder: (name) => [...state.folders.values()].find((f) => f.name === name),
    /** Mock outbound HTTP (social token verification). Return an object for a
     *  JSON 200 response, or null for a 404. */
    setFetchResponder(fn) { state.fetchResponder = fn; },
    fetches: state.fetches,
    reset() {
      state.sheets.clear();
      state.files.clear();
      state.folders.clear();
      state.mailbox.length = 0;
      state.props = {};
      state.fetches.length = 0;
      state.fetchResponder = null;
      state.seq = 0;
      // Re-register the configured folders.
      [ROOT, PENDING, APPROVED, DECLINED, MERCHANT_DOCS]
        .forEach((f) => state.folders.set(f.id, f));
      ROOT.fileIds = [];
      PENDING.fileIds = [];
      APPROVED.fileIds = [];
      DECLINED.fileIds = [];
      MERCHANT_DOCS.fileIds = [];
      spreadsheet.sheetOrder = [];
    },
  };

  return {
    state, helpers,
    SpreadsheetApp, DriveApp, MailApp, Utilities, PropertiesService,
    ScriptApp, HtmlService, ContentService, Session, LockService, Logger, UrlFetchApp,
  };
}

module.exports = { createStub };
