import { Hono } from "hono";
import {
  addMessage,
  countClaimsLast24h,
  countMessagesLast24h,
  createClaim,
  getClaimById,
  getClaimByListingAndClaimant,
  getListingById,
  getMessagesForClaim,
  getUserByNickname,
  markDisputed,
  markRejected,
  RATE_LIMITS,
  recordAgreement,
  recordConfirmation,
} from "../db";
import { getTheme, HttpError, requireUser } from "../session";
import {
  errorPage,
  esc,
  html,
  layout,
  messageBubble,
  raw,
  relativeAge,
  userSignal,
} from "../views";

export const claimRoutes = new Hono();

// ---------- POST /l/:id/claim (create claim from listing) ----------

claimRoutes.post("/l/:id/claim", async (c) => {
  const user = requireUser(c);
  const listingId = Number(c.req.param("id"));
  if (!Number.isInteger(listingId) || listingId < 1) {
    throw new HttpError(404, "Listing not found.");
  }

  const listing = getListingById(listingId);
  if (!listing) throw new HttpError(404, "Listing not found.");

  if (listing.creator_nickname === user.nickname) {
    throw new HttpError(400, "You can't claim your own listing.");
  }
  if (listing.status !== "active") {
    throw new HttpError(400, "This listing is no longer active.");
  }

  const existing = getClaimByListingAndClaimant(listingId, user.nickname);
  if (existing) {
    return c.redirect(`/c/${existing.id}`);
  }

  if (countClaimsLast24h(user.nickname) >= RATE_LIMITS.claims_per_day) {
    throw new HttpError(
      429,
      `You've made ${RATE_LIMITS.claims_per_day} claims in the last 24 hours. Wait a bit.`
    );
  }

  const form = await c.req.formData();
  const message = String(form.get("message") ?? "").trim();
  if (message.length < 1 || message.length > 2000) {
    throw new HttpError(400, "Message must be 1-2000 characters.");
  }

  const claimId = createClaim(listingId, user.nickname);
  addMessage(claimId, user.nickname, message);
  return c.redirect(`/c/${claimId}`);
});

// ---------- GET /c/:id (thread view) ----------

claimRoutes.get("/c/:id", (c) => {
  const user = requireUser(c);
  const claimId = Number(c.req.param("id"));
  if (!Number.isInteger(claimId) || claimId < 1) {
    throw new HttpError(404, "Thread not found.");
  }

  const claim = getClaimById(claimId);
  if (!claim) throw new HttpError(404, "Thread not found.");

  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(404, "Listing missing.");

  const isCreator = user.nickname === listing.creator_nickname;
  const isClaimant = user.nickname === claim.claimant_nickname;
  if (!isCreator && !isClaimant) {
    throw new HttpError(403, "This thread isn't yours.");
  }

  const messages = getMessagesForClaim(claimId);
  const messagesHtml = messages.map((m) => messageBubble(m, user.nickname).__raw).join("");

  const otherSide = isCreator ? claim.claimant_nickname : listing.creator_nickname;
  const otherUser = getUserByNickname(otherSide);

  // Build action panel based on status.
  let actionPanel = "";
  const listingClosed =
    listing.status === "completed" ||
    listing.status === "deleted" ||
    listing.status === "expired";
  if (claim.status !== "completed" && listingClosed) {
    actionPanel = html`
      <article>
        <em>This listing is no longer available
        ${listing.status === "completed" ? html` — someone else completed it.` : "."}
        </em>
      </article>
    `;
  } else if (claim.status === "pending") {
    const myAgreed = isCreator ? claim.creator_agreed : claim.claimant_agreed;
    const theirAgreed = isCreator ? claim.claimant_agreed : claim.creator_agreed;
    actionPanel = html`
      <article>
        <p>
          ${myAgreed ? "You've marked this as agreed." : raw('<strong>When you and the other side have a plan (time + place), click Agree.</strong>')}
          ${theirAgreed ? raw(` <em>${esc(otherSide)} has already clicked Agree.</em>`) : ""}
        </p>
        ${myAgreed
          ? ""
          : raw(html`
              <form method="post" action="/c/${claim.id}/agree" style="display:inline">
                <button type="submit">Agree</button>
              </form>
            `)}
        ${isCreator
          ? raw(html`
              <form method="post" action="/c/${claim.id}/reject" style="display:inline">
                <button type="submit" class="secondary outline">Reject this claim</button>
              </form>
            `)
          : ""}
      </article>
    `;
  } else if (claim.status === "agreed") {
    const myConfirmed = isCreator ? claim.creator_confirmed : claim.claimant_confirmed;
    const theirConfirmed = isCreator ? claim.claimant_confirmed : claim.creator_confirmed;
    actionPanel = html`
      <article>
        <p><strong>Agreed.</strong> After the exchange happens, click Confirm.
        ${theirConfirmed ? raw(`<em>${esc(otherSide)} has already confirmed.</em>`) : ""}
        </p>
        ${myConfirmed
          ? raw(html`<p><em>You've confirmed. Waiting for ${otherSide}.</em></p>`)
          : raw(html`
              <div class="row">
                <form method="post" action="/c/${claim.id}/confirm" style="display:inline">
                  <button type="submit">Confirm exchanged</button>
                </form>
                <form method="post" action="/c/${claim.id}/dispute" style="display:inline">
                  <button type="submit" class="secondary outline">Issue — didn't happen</button>
                </form>
              </div>
            `)}
      </article>
    `;
  } else if (claim.status === "completed") {
    actionPanel = html`
      <article style="background:var(--pico-primary-background);color:var(--pico-primary-inverse)">
        <strong>Exchange complete.</strong>
        Both tallies updated · ${relativeAge(claim.completed_at!)}.
      </article>
    `;
  } else if (claim.status === "disputed") {
    actionPanel = html`
      <article style="border-left:4px solid #c0392b">
        <strong>Marked as disputed.</strong>
        A coordinator will follow up.
      </article>
    `;
  } else if (claim.status === "rejected") {
    actionPanel = html`<article><em>This claim was rejected.</em></article>`;
  }

  const messageForm =
    claim.status === "pending" || claim.status === "agreed"
      ? html`
          <form method="post" action="/c/${claim.id}/message">
            <label>
              Send a message
              <textarea name="message" rows="3" maxlength="2000" required></textarea>
            </label>
            <button type="submit">Send</button>
          </form>
        `
      : "";

  const otherSignal = otherUser ? userSignal(otherUser).__raw : esc(otherSide);

  const body = html`
    <article>
      <hgroup>
        <h2>Thread: ${listing.title}</h2>
        <p>${raw(`<span class="type-chip ${listing.type}">${listing.type}</span>`)} with ${raw(otherSignal)}</p>
      </hgroup>
      <p><a href="/l/${listing.id}">← back to listing</a></p>
    </article>

    ${raw(actionPanel)}

    <section>
      ${messages.length === 0 ? html`<p><em>No messages yet.</em></p>` : raw(messagesHtml)}
    </section>

    ${raw(messageForm)}
  `;

  return c.html(layout({ title: `Thread · ${listing.title}`, user, body, theme: getTheme(c) }));
});

// ---------- POST /c/:id/message ----------

claimRoutes.post("/c/:id/message", async (c) => {
  const user = requireUser(c);
  const claimId = Number(c.req.param("id"));
  const claim = getClaimById(claimId);
  if (!claim) throw new HttpError(404, "Thread not found.");
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(404, "Listing missing.");

  if (user.nickname !== listing.creator_nickname && user.nickname !== claim.claimant_nickname) {
    throw new HttpError(403, "Not your thread.");
  }
  if (claim.status === "completed" || claim.status === "rejected") {
    throw new HttpError(400, "This thread is closed.");
  }

  if (countMessagesLast24h(user.nickname) >= RATE_LIMITS.messages_per_day) {
    throw new HttpError(429, "Too many messages in the last 24 hours.");
  }

  const form = await c.req.formData();
  const content = String(form.get("message") ?? "").trim();
  if (content.length < 1 || content.length > 2000) {
    throw new HttpError(400, "Message must be 1-2000 characters.");
  }

  addMessage(claimId, user.nickname, content);
  return c.redirect(`/c/${claimId}`);
});

// ---------- POST /c/:id/agree ----------

claimRoutes.post("/c/:id/agree", (c) => {
  const user = requireUser(c);
  const claimId = Number(c.req.param("id"));
  const claim = getClaimById(claimId);
  if (!claim) throw new HttpError(404, "Thread not found.");
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(404, "Listing missing.");

  const isCreator = user.nickname === listing.creator_nickname;
  const isClaimant = user.nickname === claim.claimant_nickname;
  if (!isCreator && !isClaimant) throw new HttpError(403, "Not your thread.");
  if (claim.status !== "pending") throw new HttpError(400, "Not in pending state.");

  recordAgreement(claimId, isCreator ? "creator" : "claimant");
  return c.redirect(`/c/${claimId}`);
});

// ---------- POST /c/:id/confirm ----------

claimRoutes.post("/c/:id/confirm", (c) => {
  const user = requireUser(c);
  const claimId = Number(c.req.param("id"));
  const claim = getClaimById(claimId);
  if (!claim) throw new HttpError(404, "Thread not found.");
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(404, "Listing missing.");

  const isCreator = user.nickname === listing.creator_nickname;
  const isClaimant = user.nickname === claim.claimant_nickname;
  if (!isCreator && !isClaimant) throw new HttpError(403, "Not your thread.");
  if (claim.status !== "agreed") throw new HttpError(400, "Need to agree first.");

  recordConfirmation(claimId, isCreator ? "creator" : "claimant");
  return c.redirect(`/c/${claimId}`);
});

// ---------- POST /c/:id/dispute ----------

claimRoutes.post("/c/:id/dispute", (c) => {
  const user = requireUser(c);
  const claimId = Number(c.req.param("id"));
  const claim = getClaimById(claimId);
  if (!claim) throw new HttpError(404, "Thread not found.");
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(404, "Listing missing.");

  if (user.nickname !== listing.creator_nickname && user.nickname !== claim.claimant_nickname) {
    throw new HttpError(403, "Not your thread.");
  }
  if (claim.status !== "agreed") throw new HttpError(400, "Can only dispute an agreed exchange.");

  markDisputed(claimId);
  return c.redirect(`/c/${claimId}`);
});

// ---------- POST /c/:id/reject (creator only, before agreement) ----------

claimRoutes.post("/c/:id/reject", (c) => {
  const user = requireUser(c);
  const claimId = Number(c.req.param("id"));
  const claim = getClaimById(claimId);
  if (!claim) throw new HttpError(404, "Thread not found.");
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new HttpError(404, "Listing missing.");

  if (user.nickname !== listing.creator_nickname) {
    throw new HttpError(403, "Only the listing creator can reject.");
  }
  if (claim.status !== "pending") {
    throw new HttpError(400, "Can only reject pending claims.");
  }

  markRejected(claimId);
  return c.redirect(`/c/${claimId}`);
});
