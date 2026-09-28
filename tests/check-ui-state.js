#!/usr/bin/env node
/** Exercise the real frontend state machine in a browser-like DOM. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
// Exercise the fallback messaging without loading the external Google SDK.
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
  .replace(/const GOOGLE_CLIENT_ID = "[^"]*";/,
    'const GOOGLE_CLIENT_ID = "";');
let checks = 0;
function check(value, label) {
  checks++;
  if (!value) throw Error('UI check ' + checks + ': ' + label);
}
function setup(url = 'https://pharmago.example/') {
  const calls = [];
  const rx = [
    { RxID:'RX1', UserID:'U-2026-0010', FileName:'pending.pdf', Status:'PENDING', Timestamp:'today' },
    { RxID:'RX2', UserID:'U-2026-0010', FileName:'reviewed.pdf', Status:'APPROVED', Timestamp:'yesterday' },
  ];
  const meds = [
    { MedicineID:'MED1', Name:'Vitamin C', Category:'Supplement', Price:149, Stock:4, Active:'YES', ShopName:'Green Cross' },
    { MedicineID:'MED2', Name:'Other', Category:'Tablet', Price:30, Stock:1, Active:'NO' },
  ];
  const users = [
    { UserID:'U-2026-0010', Email:'alex@example.test', Role:'USER', Status:'ACTIVE' },
    { UserID:'M123', Email:'vendor@example.test', Role:'MERCHANT', Status:'ACTIVE' },
  ];
  const merchants = [
    { MerchantID:'M123', ShopName:'Green Cross', Status:'APPROVED', DocFileIds:'GST:file123' },
    { MerchantID:'M456', ShopName:'New Pharmacy', Status:'PENDING', DocFileIds:'PAN:file456' },
  ];
  const replies = {
    login: { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} },
    register: { success:true, message:'Registered', data:{userId:'U-2026-0011',demoOtp:'123456'} },
    verify_email: { success:true, message:'Verified', data:{passwordSet:true} },
    get_medicines: { success:true, data:[meds[0]] },
    forgot_password: { success:true, message:'Link sent', data:{demoToken:'token-123'} },
    reset_password: { success:true, message:'Password set' },
  };
  const dom = new JSDOM(html, {
    url, runScripts:'dangerously',
    beforeParse(w) {
      w.fetch = async (_url, opts) => {
        const p = JSON.parse(opts.body);
        calls.push(p);
        let reply = replies[p.action];
        if (p.action === 'get_data') {
          reply = p.adminKey === 'bad' ? {success:false, message:'Admin key required'} :
            {success:true, data:({ Users:users, Prescriptions:rx, Merchants:merchants, Medicines:meds })[p.sheetName] || []};
        }
        return { text:async () => JSON.stringify(reply || {success:true,message:'OK',data:[]}) };
      };
      w.prompt = () => 'demo123';
      w.confirm = () => false;
    },
  });
  return { dom, w:dom.window, d:dom.window.document, id:n => dom.window.document.getElementById(n), calls, replies };
}
async function run() {
  const { dom, w, d, id, calls, replies } = setup();
  const last = () => calls[calls.length - 1];
  try {
    check(!d.querySelector('.hero').hidden, 'welcome section visible to guests');
    // Guest (13).
    check(/guest/.test(id('sessionBar').textContent), 'guest badge');
    check(!id('tabLogin').hidden, 'guest account tab');
    check(id('tabUser').hidden, 'guest cannot open customer portal');
    check(!id('tabShop').hidden, 'guest catalogue tab');
    check(!id('tabMerchant').hidden, 'guest pharmacy tab');
    check(!id('tabAdmin').hidden, 'guest admin tab');
    check(!id('vendorRegister').hidden, 'guest registration form');
    check(id('vendorTools').hidden, 'guest listing tools hidden');
    check(!id('adminLockCard').hidden, 'admin lock card shown');
    check(id('adminDashboard').hidden, 'admin dashboard hidden');
    check(id('logoutBtn').hidden, 'guest sign-out hidden');
    check(id('login').classList.contains('active'), 'account is landing panel');
    check(!!id('pendingRx').querySelector('[data-show="admin"]'), 'admin queues start with a loading state');

    // Navigation and catalogue (6).
    id('tabShop').click();
    check(id('shop').classList.contains('active'), 'shop panel opens');
    check(last().action === 'get_medicines', 'catalogue requested');
    await w.loadMedicines();
    check(/Vitamin C/.test(id('medTbl').textContent), 'catalogue rendered');
    check(/149/.test(id('medTbl').textContent), 'price rendered');
    id('medSearch').value = 'no match'; w.renderMedicines();
    check(!/Vitamin C/.test(id('medTbl').textContent), 'search filters rows');
    check(/0 medicine/.test(id('shopMsg').textContent), 'filtered count shown');

    // Registration and verification (8).
    await w.doRegister();
    check(!calls.some(c => c.action === 'register'), 'empty registration blocked');
    id('rEmail').value = 'new@example.test'; id('rPhone').value = '9800000011';
    id('rPass').value = 'secret123'; id('rPass2').value = 'mismatch';
    await w.doRegister();
    check(!calls.some(c => c.action === 'register'), 'mismatched password blocked');
    id('rPass2').value = 'secret123'; await w.doRegister();
    check(last().action === 'register', 'registration sent');
    check(id('viewVerify').style.display !== 'none', 'OTP screen shown');
    check(id('vIdShow').textContent === 'U-2026-0011', 'new user ID shown');
    check(/123456/.test(id('verifyMsg').textContent), 'demo OTP shown');
    await w.doVerify();
    check(last().action === 'register', 'incomplete OTP blocked');
    d.querySelectorAll('.otp').forEach((box, i) => { box.value = String(i + 1); });
    await w.doVerify();
    check(last().action === 'verify_email', 'OTP submitted');

    // Customer session (8).
    replies.login = { success:false, message:'Wrong password' }; await w.doLogin();
    check(id('loginMsg').classList.contains('err'), 'failed login message');
    check(!w.localStorage.getItem('pharmago_session'), 'failed login not stored');
    replies.login = { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} }; await w.doLogin();
    check(d.querySelector('.hero').hidden, 'welcome section hidden after customer login');
    check(id('tabLogin').hidden, 'account tab hidden for customer');
    check(!id('tabUser').hidden, 'customer portal tab visible');
    check(id('user').classList.contains('active'), 'customer lands in portal');
    check(/Customer/.test(id('sessionBar').textContent), 'customer badge');
    check(id('vendorRegister').hidden, 'registration hidden for customer');
    check(!id('logoutBtn').hidden, 'customer can sign out');
    await w.loadHistory();
    check(/RX1/.test(id('rxHistory').textContent) && !!id('rxHistory').querySelector('[onclick*="openRxViewer"]'), 'customer can view own prescriptions');
    w.eval('window.__rx = historyCache; historyCache = []; renderHistory();');
    check(/No prescriptions yet/.test(id('rxHistory').textContent), 'empty history explains itself');
    w.eval('historyCache = window.__rx; renderHistory(); delete window.__rx;');

    // Merchant session (8).
    w.logout();
    check(!d.querySelector('.hero').hidden, 'welcome section restored after logout');
    check(id('login').classList.contains('active'), 'logout returns to guest account');
    replies.login = { success:true, data:{userId:'M123',role:'MERCHANT',name:'Green Cross'} }; await w.doLogin();
    check(d.querySelector('.hero').hidden, 'welcome section hidden after pharmacy login');
    check(id('tabUser').hidden, 'vendor cannot open customer portal');
    check(id('merchant').classList.contains('active'), 'vendor lands in shop');
    check(!id('vendorTools').hidden, 'vendor listing tools shown');
    check(id('vendorRegister').hidden, 'vendor registration hidden');
    check(/My shop/.test(id('tabMerchant').textContent), 'vendor navigation relabelled');
    check(!!id('tabMerchant').querySelector('svg') && id('tabMerchant').getAttribute('aria-label') === 'My shop',
      'relabelled pharmacy tab keeps its icon and accessible name');
    await w.loadMyListings();
    check(/MED1/.test(id('myMedTbl').textContent), 'own listings displayed');
    check(!!id('myMedTbl').querySelector('[onclick^="editMyMedicine"]'), 'edit action available');

    // Admin independently unlockable on top of a vendor session (13).
    id('adminKey').value = 'bad'; await w.adminAuth();
    check(id('adminDashboard').hidden, 'invalid key leaves admin hidden');
    check(id('adminMsg').classList.contains('err'), 'invalid key error shown');
    id('adminKey').value = 'test-key'; await w.adminAuth();
    check(!id('adminDashboard').hidden, 'dashboard appears');
    check(id('adminLockCard').hidden, 'lock card hides');
    check(/Admin/.test(id('sessionBar').textContent), 'admin badge stacks with vendor');
    check(id('statUsers').textContent === '1', 'customer count');
    check(id('statRx').textContent === '1', 'pending prescription count');
    check(id('statVendors').textContent === '1', 'pending pharmacy count');
    check(id('statMedicines').textContent === '1', 'active medicine count');
    check(/RX1/.test(id('pendingRx').textContent), 'pending prescription identified');
    id('rxFilter').value = 'ALL'; w.renderAdminRx();
    check(/RX2/.test(id('pendingRx').textContent), 'reviewed prescription ID identified');
    check(!!id('pendingRx').querySelector('[onclick*="openRxViewer"]'), 'admin can view prescription');
    check(!!id('userList').querySelector('[onclick*="filterRxByUser"]'), 'user row opens that patient prescriptions');
    check(!!id('merchantList').querySelector('a[href="https://drive.google.com/file/d/file456/view"]'), 'KYC document link');
    check(!!id('adminMedicineList').querySelector('[onclick^="setMedicineActive"]'), 'admin catalogue actions');

    // Lock, sign out, and reset deep-link (6).
    w.lockAdmin();
    check(id('adminDashboard').hidden, 'lock hides dashboard');
    check(id('adminLockCard').hidden === false, 'lock shows key form');
    check(!id('logoutBtn').hidden, 'locking admin preserves vendor login');
    w.logout();
    check(id('login').classList.contains('active'), 'sign out returns to account');
    check(!w.localStorage.getItem('pharmago_session'), 'session removed');
    check(id('vendorRegister').hidden === false, 'guest registration restored');

    // Clinical chrome: icon rail, workspace header and a11y state (6).
    check(id('tabLogin').getAttribute('aria-current') === 'page', 'active rail item exposes aria-current');
    check(id('crumbRole').textContent === 'Guest workspace', 'workspace header names the guest space');
    check(/Sign in/.test(id('crumbTitle').textContent), 'workspace header describes the landing tab');
    check(['Account', 'My prescriptions', 'Browse medicines', 'For pharmacies', 'Admin']
      .every((name, i) => d.querySelectorAll('.tabs button')[i].getAttribute('aria-label') === name),
      'every rail tab carries an accessible name for the icon-only small-screen dock');
    const rail = d.querySelector('.sidebar');
    check(!!rail && rail.querySelectorAll('.tabs button').length === 5 &&
      !!rail.querySelector('#sessionBar') && !!rail.querySelector('#networkState'),
      'icon rail holds navigation, session chip and connection pill');
    id('tabShop').click();
    check(/catalogue/i.test(id('crumbTitle').textContent), 'workspace header follows the open tab');
    replies.login = { success:true, data:{userId:'M123',role:'MERCHANT',name:'Green Cross'} }; await w.doLogin();
    check(id('crumbRole').textContent === 'Pharmacy workspace', 'workspace header follows the role');

    // Delivery form requirements and safe rendering.
    check(id('rxDeliveryForm').querySelectorAll('[required]').length === 6, 'six required delivery fields');
    check(!id('rxDeliveryForm').checkValidity(), 'empty delivery form cannot submit');
    id('rxReceiverName').value = 'Private receiver';
    w.logout();
    check(id('rxReceiverName').value === '', 'logout clears delivery form');
    const details = w.deliveryDetailsHtml({DeliveryAddress:'<img src=x onerror=alert(1)>', ReceiverPhone:'9800000002'});
    const detailNode = d.createElement('div'); detailNode.innerHTML = details;
    check(!detailNode.querySelector('img') && detailNode.textContent.includes('<img'), 'delivery details escape HTML');
    check(w.deliveryDetailsHtml({}).includes('not recorded'), 'legacy prescriptions have a delivery fallback');

    // Upload state is independent of focus and recovers from read/API failures.
    replies.login = { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} };
    await w.doLogin();
    const fields = {rxPatientName:'Patient', rxReceiverName:'Receiver', rxConfirmationPhone:'9800000001',
      rxReceiverPhone:'9800000002', rxDeliveryAddress:'Ward 4, Demo Street', rxDeliveryCity:'Kathmandu'};
    Object.entries(fields).forEach(([key,value]) => { id(key).value = value; });
    w.copyConfirmationPhone();
    check(id('rxReceiverPhone').value === fields.rxConfirmationPhone, 'copy confirmation phone shortcut');
    check(d.activeElement === id('rxReceiverPhone'), 'copy shortcut focuses receiver phone');
    Object.defineProperty(id('rxFile'), 'files', { configurable:true, value:[new w.File(['rx'], 'rx.pdf', {type:'application/pdf'})] });
    let finishRead;
    w.fileToBase64 = () => new Promise(resolve => { finishRead = resolve; });
    const uploading = w.uploadRx();
    check(id('rxUploadBtn').disabled && !id('rxUploadProgress').hidden, 'busy feedback starts while reading file');
    check(id('rxDeliveryForm').getAttribute('aria-busy') === 'true', 'form announces busy state');
    check(id('rxFile').disabled && id('rxPatientName').disabled, 'inputs locked while uploading');
    const countBefore = calls.filter(c => c.action === 'upload_rx').length;
    await w.uploadRx();
    check(calls.filter(c => c.action === 'upload_rx').length === countBefore, 'duplicate submission blocked');
    replies.upload_rx = {success:false, message:'Please retry'};
    finishRead('cng='); await uploading;
    check(id('rxPatientName').value === 'Patient', 'API failure preserves typed details');
    check(!id('rxUploadBtn').disabled && id('rxUploadProgress').hidden, 'API failure clears busy state');
    check(last().receiverPhone === fields.rxConfirmationPhone, 'copied number submitted to API');
    w.fileToBase64 = async () => { throw Error('Unreadable'); };
    await w.uploadRx();
    check(id('userMsg').textContent.includes('please try again'), 'file read failure gives retry message');
    check(!id('rxFile').disabled && !id('rxPatientName').disabled, 'file read failure unlocks controls');
    w.fileToBase64 = async () => 'cng=';
    replies.upload_rx = {success:true, message:'Uploaded'};
    await w.uploadRx();
    check(id('rxPatientName').value === '', 'successful upload resets delivery form');
    check(!id('rxDeliveryForm').hasAttribute('aria-busy'), 'successful upload clears accessible busy state');

    // Empty states plus the prescription viewer dialog (5).
    w.logout();
    replies.login = { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} }; await w.doLogin();
    id('adminKey').value = 'test-key'; await w.adminAuth();
    id('rxUserFilter').value = 'U-NONE'; w.renderAdminRx('U-NONE');
    check(/No prescriptions in this view/.test(id('pendingRx').textContent), 'filtered admin queue shows an empty state');
    id('rxUserFilter').value = ''; w.renderAdminRx();
    id('tabUser').click();
    await w.loadHistory();
    check(!!id('rxHistory').querySelector('[onclick*="openRxViewer"]'), 'history cards expose the viewer');
    w.lastFocused = id('tabUser');   // a control that survives the list re-render
    id('rxViewer').hidden = false; d.body.classList.add('viewer-open');
    const tabKey = new w.KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true });
    d.dispatchEvent(tabKey);
    check(tabKey.defaultPrevented && d.activeElement === id('rxViewerClose'), 'Tab is trapped inside the dialog');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    check(id('rxViewer').hidden && !d.body.classList.contains('viewer-open'), 'Escape closes the dialog');
    check(d.activeElement !== id('rxViewerClose'), 'focus leaves the dialog once it closes');

    // ePharmacy-style sign-in card: social buttons + one-time email code (16).
    w.logout();
    check(id('viewLogin').style.display !== 'none', 'logout returns to the password sign-in view');
    check(/Welcome back/i.test(id('viewLogin').textContent), 'welcome back heading');
    check(/Returning customer/i.test(id('viewLogin').textContent), 'returning customer kicker');
    check(/Not a member/i.test(id('viewLogin').textContent), 'sign up prompt');
    check(!!id('lRemember') && id('lRemember').checked, 'remember me defaults to on');
    check(!!d.querySelector('#viewLogin .auth-link[onclick*="forgot"]'), 'forgot password link');
    check(!!d.querySelector('#viewLogin .btn.google'), 'google button');
    check(!d.querySelector('#viewLogin .btn.fb'), 'no facebook button');
    check(!!d.querySelector('#viewLogin .social-divider'), 'or-divider above the provider button');
    w.socialLogin();
    check(/not configured/i.test(id('loginMsg').textContent), 'unconfigured social login explains setup');
    w.startCodeLogin();
    check(id('viewCode').style.display !== 'none', 'one-time code view opens');
    check(id('viewLogin').style.display === 'none', 'password form hidden in code view');
    id('cId').value = 'code@example.test';
    replies.login_code = { success:true, message:'Code sent', data:{demoOtp:'654321'} };
    await w.doCodeRequest();
    check(last().action === 'login_code', 'code login requested');
    check(/654321/.test(id('codeMsg').textContent), 'demo one-time code shown');
    check(id('codeEntry').hidden === false && id('cId').disabled, 'code entry revealed after send');
    d.querySelectorAll('.cotp').forEach((b, i) => { b.value = String((i + 4) % 10); });
    replies.login_code_verify = { success:true, message:'Login successful',
      data:{userId:'U-2026-0010',role:'USER',name:'Alex',passwordSet:true} };
    await w.doCodeVerify();
    check(calls.some(c => c.action === 'login_code_verify'), 'one-time code submitted');
    check(id('user').classList.contains('active'), 'code sign-in lands in the portal');
    check(!!w.localStorage.getItem('pharmago_session'), 'code sign-in remembered');
    w.logout();
    id('lRemember').checked = false;
    replies.login = { success:true, data:{userId:'U-2026-0010',role:'USER',name:'Alex'} }; await w.doLogin();
    check(!w.localStorage.getItem('pharmago_session') && !!w.sessionStorage.getItem('pharmago_session'),
      'session-only sign-in when remember me is off');
    w.logout();
    // Successful actions transition; failures preserve the current form.
    w.showView('forgot');
    id('fId').value = 'alex@example.test';
    replies.forgot_password = { success:false, message:'Try again' };
    await w.doForgot();
    check(!id('actionComplete').classList.contains('active'), 'failed action does not navigate');
    check(id('fId').value === 'alex@example.test', 'failed action keeps input');
    replies.forgot_password = { success:true, message:'Link sent' };
    await w.doForgot();
    check(id('actionComplete').classList.contains('active'), 'successful action opens confirmation page');
    check(d.querySelectorAll('.panel.active').length === 1, 'only confirmation page is visible');
    check(d.activeElement === id('actionCompleteTitle'), 'confirmation heading receives focus');
    check(id('actionCompleteMessage').textContent === 'Link sent', 'confirmation preserves API feedback');
    id('actionCompleteNext').click();
    check(id('login').classList.contains('active'), 'continue opens destination page');
    check(id('viewLogin').style.display !== 'none', 'continue opens sign-in form');
  } finally { dom.window.close(); }
  if (checks !== 128) throw Error('Expected 128 UI-state checks, got ' + checks);
  console.log('✓ 128 UI-state checks passed');
}
run().catch(err => { console.error('✗ ' + err.stack); process.exitCode = 1; });
