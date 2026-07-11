import { Hono } from "hono";
import {
  CATEGORIES,
  getClaimsForUser,
  getClaimsOnMyListings,
  getListingById,
  getListingsByCreator,
  getUserByNickname,
  setPasswordHash,
  updateOptionalFields,
  type Claim,
  type Listing,
} from "../db";
import {
  getTheme,
  HttpError,
  requireUser,
} from "../session";
import {
  esc,
  html,
  layout,
  raw,
  relativeAge,
  userSignal,
} from "../views";
import { renderListingModals } from "./listings";

export const profileRoutes = new Hono();

// ---------- GET /me ----------

profileRoutes.get("/me", (c) => {
  const user = requireUser(c);

  const myListings = getListingsByCreator(user.nickname);
  const myClaims = getClaimsForUser(user.nickname);
  const claimsOnMyStuff = getClaimsOnMyListings(user.nickname);

  // Combine: all claims I'm involved in, with my role
  const allInvolved: { claim: Claim; listing: Listing; role: "creator" | "claimant" }[] = [];
  for (const claim of claimsOnMyStuff) {
    const listing = getListingById(claim.listing_id);
    if (listing) allInvolved.push({ claim, listing, role: "creator" });
  }
  for (const claim of myClaims) {
    const listing = getListingById(claim.listing_id);
    if (listing) allInvolved.push({ claim, listing, role: "claimant" });
  }
  allInvolved.sort((a, b) => b.claim.created_at - a.claim.created_at);

  const exchangeRows: string = allInvolved.length === 0
    ? html`<p><em>No exchanges yet.</em></p>`
    : `<ul>${allInvolved.map(({ claim, listing, role }) => html`
        <li>
          <a href="/c/${claim.id}">${listing.title}</a>
          · <small>${listing.type} · ${role === "creator" ? "your listing" : "you claimed"}</small>
          · <strong>${claim.status}</strong>
          · ${relativeAge(claim.created_at)}
        </li>`).join("")}</ul>`;

  // Only modal-link to listings still in active/agreed status (the others don't have view modals embedded).
  const listingRows: string = myListings.length === 0
    ? html`<p><em>No listings yet. <a href="/#new-listing">Create one.</a></em></p>`
    : `<ul>${myListings.map((l) => {
        const linkable = l.status === "active" || l.status === "agreed";
        const href = linkable ? `#l-${l.id}` : `/l/${l.id}`;
        const editChip = linkable
          ? ` · <a href="#edit-l-${l.id}" class="listing-card__edit" style="font-size:0.75rem">edit</a>`
          : "";
        return html`
        <li>
          <a href="${href}">${l.title}</a>
          · <small>${l.type} · ${CATEGORIES.find((c) => c.key === l.category)?.label ?? l.category}</small>
          · <strong>${l.status}</strong>
          · ${relativeAge(l.created_at)}${raw(editChip)}
        </li>`;
      }).join("")}</ul>`;

  const vouchBy = user.vouched_by ? ` by ${user.vouched_by}` : "";
  const vouchWhen = user.vouched_at ? ` · ${relativeAge(user.vouched_at)}` : "";
  const vouchInfo = user.is_vouched
    ? html`<p class="gg-muted-line"><span class="signal"><span class="badge vouched">✓ vouched</span>${vouchBy}${vouchWhen}</span></p>`
    : html`<p class="gg-muted-line"><span class="signal"><span class="badge new">new — unvouched</span></span> · meet your coordinator in person to get vouched.</p>`;

  const passwordSection = user.password_hash
    ? html`<p><small>Password is set — your nickname is recoverable.</small></p>`
    : html`
        <details class="action">
          <summary><strong>Set a password (optional)</strong></summary>
          <p><small>Without a password, your nickname only lives as long as your browser cookie. Set one to recover access from another device.</small></p>
          <form method="post" action="/me/password">
            <label>
              New password
              <input type="password" name="password" minlength="6" maxlength="200" required>
            </label>
            <button type="submit">Save password</button>
          </form>
        </details>
      `;

  const body = html`
    <div class="gg-stack">
      <article class="gg-article gg-profile-hero">
        <h2>${user.nickname}</h2>
        <p class="gg-stat-line">Given ${user.given_count} · Received ${user.received_count}</p>
        ${raw(vouchInfo)}
      </article>

      <article class="gg-article">
        <h3>Optional contact info <small>(never required)</small></h3>
        <p class="gg-help">If you fill these in, others can see them on your public profile. Leave blank to stay anonymous.</p>
        <form method="post" action="/me" class="gg-form-stack">
          <label>
            Phone
            <input type="text" name="phone" value="${user.phone ?? ""}" maxlength="40" placeholder="optional">
          </label>
          <label>
            Email
            <input type="email" name="email" value="${user.email ?? ""}" maxlength="200" placeholder="optional">
          </label>
          <label>
            Bio
            <textarea name="bio" rows="3" maxlength="500" placeholder="optional">${user.bio ?? ""}</textarea>
          </label>
          <button type="submit">Save</button>
        </form>
        ${raw(passwordSection)}
      </article>

      <article class="gg-article">
        <h3>My listings</h3>
        ${raw(listingRows)}
      </article>

      <article class="gg-article">
        <h3>My exchanges</h3>
        ${raw(exchangeRows)}
      </article>
    </div>

    ${raw(renderListingModals(
      myListings.filter((l) => l.status === "active" || l.status === "agreed"),
      user
    ))}
  `;

  return c.html(layout({ title: "My profile", user, body, theme: getTheme(c), activeNav: "profile" }));
});

// ---------- POST /me (update optional fields) ----------

profileRoutes.post("/me", async (c) => {
  const user = requireUser(c);
  const form = await c.req.formData();

  const phone = String(form.get("phone") ?? "").trim() || null;
  const email = String(form.get("email") ?? "").trim() || null;
  const bio = String(form.get("bio") ?? "").trim() || null;

  if (phone && phone.length > 40) throw new HttpError(400, "Phone too long.");
  if (email && email.length > 200) throw new HttpError(400, "Email too long.");
  if (bio && bio.length > 500) throw new HttpError(400, "Bio too long.");

  updateOptionalFields(user.nickname, phone, email, bio);
  return c.redirect("/me");
});

// ---------- POST /me/password (set password) ----------

profileRoutes.post("/me/password", async (c) => {
  const user = requireUser(c);
  const form = await c.req.formData();
  const pw = String(form.get("password") ?? "");
  if (pw.length < 6 || pw.length > 200) {
    throw new HttpError(400, "Password must be 6-200 characters.");
  }
  const hash = await Bun.password.hash(pw, { algorithm: "bcrypt", cost: 10 });
  setPasswordHash(user.nickname, hash);
  return c.redirect("/me");
});

// ---------- GET /u/:nickname (other user's public profile) ----------

profileRoutes.get("/u/:nickname", (c) => {
  const viewer = requireUser(c);
  const target = c.req.param("nickname");
  const u = getUserByNickname(target);
  if (!u) throw new HttpError(404, "User not found.");

  const activeListings = getListingsByCreator(u.nickname).filter((l) => l.status === "active");

  const listingRows: string = activeListings.length === 0
    ? html`<p><em>No active listings.</em></p>`
    : `<ul>${activeListings.map((l) => html`
        <li>
          <a href="#l-${l.id}">${l.title}</a>
          · <small>${l.type} · ${CATEGORIES.find((c) => c.key === l.category)?.label ?? l.category}</small>
          · ${relativeAge(l.created_at)}
        </li>`).join("")}</ul>`;

  const contactBits: string[] = [];
  if (u.phone) contactBits.push(html`Phone: ${u.phone}`);
  if (u.email) contactBits.push(html`Email: ${u.email}`);
  const contactBlock = contactBits.length > 0
    ? html`<p>${raw(contactBits.join(" · "))}</p>`
    : "";
  const bioBlock = u.bio
    ? html`<blockquote>${u.bio}</blockquote>`
    : "";

  const vouchInfo = u.is_vouched
    ? html`<p><span class="badge vouched">✓ vouched</span>${u.vouched_by ? html` by ${u.vouched_by}` : ""} · ${u.vouched_at ? relativeAge(u.vouched_at) : ""}</p>`
    : html`<p><span class="badge new">new — unvouched</span></p>`;

  // Coordinator-only vouch button on other profiles (not on self)
  const vouchButton =
    viewer.is_coordinator && viewer.nickname !== u.nickname
      ? u.is_vouched
        ? html`
            <form method="post" action="/coord/unvouch/${u.nickname}">
              <button type="submit" class="secondary outline">Un-vouch ${u.nickname}</button>
            </form>
          `
        : html`
            <form method="post" action="/coord/vouch/${u.nickname}">
              <button type="submit">Vouch for ${u.nickname}</button>
            </form>
          `
      : "";

  const goodwillForm =
    viewer.is_coordinator && viewer.nickname !== u.nickname
      ? html`
          <details class="action">
            <summary><strong>Grant goodwill +1 to ${u.nickname}</strong></summary>
            <form method="post" action="/coord/goodwill/${u.nickname}">
              <label>
                Reason (logged, visible in coordinator panel)
                <input type="text" name="reason" maxlength="200" required placeholder="hosted swap day, helped with…">
              </label>
              <button type="submit">Grant +1 Given</button>
            </form>
          </details>
        `
      : "";

  const body = html`
    <article>
      <hgroup>
        <h2>${u.nickname}</h2>
        <p>Given ${u.given_count} · Received ${u.received_count}</p>
      </hgroup>
      ${raw(vouchInfo)}
      ${raw(contactBlock)}
      ${raw(bioBlock)}
      ${raw(vouchButton)}
      ${raw(goodwillForm)}
    </article>

    <article>
      <h3>Active listings</h3>
      ${raw(listingRows)}
    </article>

    ${raw(renderListingModals(activeListings, viewer))}
  `;

  return c.html(layout({ title: u.nickname, user: viewer, body, theme: getTheme(c) }));
});
