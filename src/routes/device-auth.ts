import { Hono } from "hono";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import { getCoordNavVisible, requireAdminForDeviceSetup, isDeviceVerified, adminHasPasskeys, clearDeviceCookie, createAuthenticationOptions, createRegistrationOptions, setDeviceCookie, verifyAuthentication, verifyRegistration } from "../device-auth";
import { getTheme, HttpError } from "../session";
import { esc, html, layout } from "../views";

export const deviceAuthRoutes = new Hono();

deviceAuthRoutes.onError((err, c) => {
  const isApi =
    c.req.method === "POST" &&
    (c.req.path.endsWith("/options") || c.req.path.endsWith("/verify"));
  if (err instanceof HttpError && isApi) {
    return c.json({ error: err.message }, err.status);
  }
  throw err;
});

const b64 = `
function b64urlToBuf(v){const p='='.repeat((4-v.length%4)%4);const b=atob((v+p).replace(/-/g,'+').replace(/_/g,'/'));const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer;}
function bufToB64url(buf){const b=new Uint8Array(buf);let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
function prepReg(o){o.challenge=b64urlToBuf(o.challenge);o.user.id=b64urlToBuf(o.user.id);if(o.excludeCredentials)o.excludeCredentials.forEach(c=>{c.id=b64urlToBuf(c.id);});return o;}
function prepAuth(o){o.challenge=b64urlToBuf(o.challenge);if(o.allowCredentials)o.allowCredentials.forEach(c=>{c.id=b64urlToBuf(c.id);});return o;}
function packReg(cred,label){const r=cred.response;return {id:cred.id,rawId:bufToB64url(cred.rawId),type:cred.type,response:{clientDataJSON:bufToB64url(r.clientDataJSON),attestationObject:bufToB64url(r.attestationObject),transports:r.getTransports?.()},clientExtensionResults:cred.getClientExtensionResults(),authenticatorAttachment:cred.authenticatorAttachment,label};}
function packAuth(cred){const r=cred.response;return {id:cred.id,rawId:bufToB64url(cred.rawId),type:cred.type,response:{clientDataJSON:bufToB64url(r.clientDataJSON),authenticatorData:bufToB64url(r.authenticatorData),signature:bufToB64url(r.signature),userHandle:r.userHandle?bufToB64url(r.userHandle):undefined},clientExtensionResults:cred.getClientExtensionResults(),authenticatorAttachment:cred.authenticatorAttachment};}
async function postJson(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed');return j;}
`;

deviceAuthRoutes.get("/auth/device", (c) => {
  const user = requireAdminForDeviceSetup(c);
  const verified = isDeviceVerified(c, user.nickname);
  const hasKeys = adminHasPasskeys(user.nickname);

  const body = html`
    <article class="gg-article gg-device-auth">
      <h2>Admin device unlock</h2>
      <p>Signed in as <strong>${user.nickname}</strong>. Coordinator tools stay hidden until this device is verified with your passkey.</p>
      <p class="gg-device-auth__status">${verified ? "✓ This device is unlocked." : "This device is not unlocked yet."}</p>
      <div class="gg-device-auth__actions">
        <button type="button" class="gg-btn-post" id="gg-passkey-primary">${hasKeys ? "Unlock with passkey" : "Register passkey on this device"}</button>
        ${hasKeys ? raw(`<button type="button" class="gg-btn-secondary" id="gg-passkey-register">Add another device</button>`) : ""}
        ${verified ? raw(`<form method="post" action="/auth/device/logout"><button type="submit" class="gg-btn-secondary">Lock this device</button></form>`) : ""}
      </div>
      <p id="gg-passkey-msg" class="gg-device-auth__msg" role="status"></p>
      <p class="gg-device-auth__hint"><small>Bookmark this page. It is not linked anywhere in the app.</small></p>
    </article>
    <script>${raw(b64)}</script>
    <script>${raw(`
(async()=>{
  const msg=(t)=>{const el=document.getElementById('gg-passkey-msg');if(el)el.textContent=t||'';};
  async function register(extra){
    msg('Waiting for passkey…');
    const opts=prepReg(await postJson('/auth/device/register/options',{}));
    const cred=await navigator.credentials.create({publicKey:opts});
    if(!cred) throw new Error('Cancelled');
    const label=extra?'Another device':(navigator.userAgent.includes('Mobile')?'Phone':'This device');
    await postJson('/auth/device/register/verify',{...packReg(cred,label)});
    msg('Passkey registered. Redirecting…');
    location.href='/coord';
  }
  async function unlock(){
    msg('Waiting for passkey…');
    const opts=prepAuth(await postJson('/auth/device/login/options',{}));
    const cred=await navigator.credentials.get({publicKey:opts});
    if(!cred) throw new Error('Cancelled');
    await postJson('/auth/device/login/verify',packAuth(cred));
    msg('Device unlocked. Redirecting…');
    location.href='/coord';
  }
  const primary=document.getElementById('gg-passkey-primary');
  const addBtn=document.getElementById('gg-passkey-register');
  if(!window.PublicKeyCredential){msg('Passkeys are not supported in this browser.');return;}
  primary?.addEventListener('click',()=>(${hasKeys ? "unlock()" : "register(false)"}).catch(e=>msg(e.message)));
  addBtn?.addEventListener('click',()=>register(true).catch(e=>msg(e.message)));
})();`)}</script>
  `;

  return c.html(
    layout({
      title: "Device unlock",
      user,
      body,
      theme: getTheme(c),
      coordNavVisible: getCoordNavVisible(c, user),
    })
  );
});

deviceAuthRoutes.post("/auth/device/logout", (c) => {
  const user = requireAdminForDeviceSetup(c);
  clearDeviceCookie(c);
  return c.redirect("/auth/device");
});

deviceAuthRoutes.post("/auth/device/register/options", async (c) => {
  const user = requireAdminForDeviceSetup(c);
  const options = await createRegistrationOptions(user.nickname);
  return c.json(options);
});

deviceAuthRoutes.post("/auth/device/register/verify", async (c) => {
  const user = requireAdminForDeviceSetup(c);
  const body = (await c.req.json()) as RegistrationResponseJSON & { label?: string };
  const credId = await verifyRegistration(user.nickname, body, body.label);
  setDeviceCookie(c, user.nickname, credId);
  return c.json({ ok: true });
});

deviceAuthRoutes.post("/auth/device/login/options", async (c) => {
  const user = requireAdminForDeviceSetup(c);
  const options = await createAuthenticationOptions(user.nickname);
  return c.json(options);
});

deviceAuthRoutes.post("/auth/device/login/verify", async (c) => {
  const user = requireAdminForDeviceSetup(c);
  const body = (await c.req.json()) as AuthenticationResponseJSON;
  const credId = await verifyAuthentication(user.nickname, body);
  setDeviceCookie(c, user.nickname, credId);
  return c.json({ ok: true });
});
