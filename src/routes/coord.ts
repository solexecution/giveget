import { Hono } from "hono";
import {
  allUsers,
  CATEGORIES,
  getActiveListings,
  getImbalanceFlags,
  getListingById,
  getUserByNickname,
  grantGoodwill,
  ipClusters,
  setListingStatus,
  unvouchUser,
  vouchUser,
} from "../db";
import { getCoordNavVisible, requireCoordinatorDevice } from "../device-auth";
import { getTheme, HttpError } from "../session";
import {
  esc,
  html,
  layout,
  raw,
  relativeAge,
  userSignal,
} from "../views";
import { renderListingModals } from "./listings";

export const coordRoutes = new Hono();

// ---------- GET /coord ----------

coordRoutes.get("/coord", (c) => {
  const user = requireCoordinatorDevice(c);

  const flags = getImbalanceFlags();
  const users = allUsers();
  const clusters = ipClusters();
  const activeGives = getActiveListings("give");
  const activeGets = getActiveListings("get");

  // Truncate a User-Agent to something human-glanceable.
  const uaSummary = (ua: string | null): string => {
    if (!ua) return "—";
    const m = ua.match(/(Chrome|Firefox|Safari|Edge|Bun|curl)[\/]?([\d.]+)?/);
    return m ? m[0] : ua.slice(0, 24);
  };

  const flagRows: string = flags.length === 0
    ? html`<p><em>No imbalance flags. (A flag fires when Received &gt; Given + 3 and unvouched.)</em></p>`
    : `<ul>${flags.map((f) => html`
        <li>
          <a href="/u/${f.nickname}"><strong>${f.nickname}</strong></a>
          · Given ${f.given_count} · Received ${f.received_count}
          · gap of ${f.received_count - f.given_count}
        </li>`).join("")}</ul>`;

  const memberRows: string = users.length === 0
    ? html`<p><em>No members yet.</em></p>`
    : `<table>
        <thead><tr><th>Member</th><th>Given</th><th>Received</th><th>Vouched</th><th>Created</th><th>Last IP</th><th>UA</th><th>Last seen</th><th></th></tr></thead>
        <tbody>${users.map((u) => html`
          <tr>
            <td><a href="/u/${u.nickname}"><strong>${u.nickname}</strong></a>${u.is_coordinator ? raw(' <small>(coord)</small>') : ""}</td>
            <td>${u.given_count}</td>
            <td>${u.received_count}</td>
            <td>${u.is_vouched ? raw(`✓ ${esc(u.vouched_by ?? "")}`) : "—"}</td>
            <td>${relativeAge(u.created_at)}</td>
            <td><small>${u.last_ip ?? "—"}</small></td>
            <td><small title="${esc(u.last_user_agent ?? "")}">${esc(uaSummary(u.last_user_agent))}</small></td>
            <td><small>${u.last_seen_at ? relativeAge(u.last_seen_at) : "—"}</small></td>
            <td>${
              u.nickname === user.nickname
                ? ""
                : u.is_vouched
                  ? raw(`<form method="post" action="/coord/unvouch/${esc(u.nickname)}" style="display:inline;margin:0"><button type="submit" class="secondary outline" style="padding:0.2rem 0.5rem;margin:0">unvouch</button></form>`)
                  : raw(`<form method="post" action="/coord/vouch/${esc(u.nickname)}" style="display:inline;margin:0"><button type="submit" style="padding:0.2rem 0.5rem;margin:0">vouch</button></form>`)
            }</td>
          </tr>`).join("")}</tbody>
      </table>`;

  const clusterSection: string = clusters.length === 0
    ? html`<p><em>No accounts sharing IPs. (A cluster appears when two or more accounts have ever been seen from the same IP.)</em></p>`
    : `<ul>${clusters.map((c) => html`
        <li>
          <code>${c.ip}</code> · <strong>${c.n}</strong> account${c.n === 1 ? "" : "s"}:
          ${raw(c.nicknames.split(",").map((n) => `<a href="/u/${esc(n)}">${esc(n)}</a>`).join(", "))}
        </li>`).join("")}</ul>`;

  const listingRow = (l: typeof activeGives[number]) => {
    const creator = getUserByNickname(l.creator_nickname);
    return html`
      <tr>
        <td><a href="#l-${l.id}"><strong>${l.title}</strong></a></td>
        <td>${CATEGORIES.find((c) => c.key === l.category)?.label ?? l.category}</td>
        <td>${creator ? raw(userSignal(creator).__raw) : esc(l.creator_nickname)}</td>
        <td>${relativeAge(l.created_at)}</td>
        <td>
          <form method="post" action="/coord/delete-listing/${l.id}" style="display:inline;margin:0"
            onsubmit="return confirm('Hard-delete this listing?')">
            <button type="submit" class="secondary outline" style="padding:0.2rem 0.5rem;margin:0;color:#c0392b">delete</button>
          </form>
        </td>
      </tr>
    `;
  };

  const givesTable: string = activeGives.length === 0
    ? html`<p><em>No active gives.</em></p>`
    : `<table><thead><tr><th>Title</th><th>Category</th><th>From</th><th>Age</th><th></th></tr></thead><tbody>${activeGives.map(listingRow).join("")}</tbody></table>`;

  const getsTable: string = activeGets.length === 0
    ? html`<p><em>No active gets.</em></p>`
    : `<table><thead><tr><th>Title</th><th>Category</th><th>From</th><th>Age</th><th></th></tr></thead><tbody>${activeGets.map(listingRow).join("")}</tbody></table>`;

  const body = html`
    <h2 class="gg-page-title">Coordinator panel</h2>
    <p class="gg-page-sub">Vouch new members, grant goodwill, watch for imbalance, delete spam.</p>

    <div class="gg-stack">
      <article class="gg-article">
        <h3>Imbalance flags</h3>
        ${raw(flagRows)}
      </article>

      <article class="gg-article">
        <h3>Device & IP clusters${clusters.length > 0 ? ` (${clusters.length})` : ""}</h3>
        <p class="gg-help">Accounts that have shared an IP address. Family sharing a router is normal; many fresh accounts on one IP is not.</p>
        ${raw(clusterSection)}
      </article>

      <article class="gg-article">
        <h3>Members (${users.length})</h3>
        ${raw(memberRows)}
      </article>

      <article class="gg-article">
        <h3>Active gives (${activeGives.length})</h3>
        ${raw(givesTable)}
      </article>

      <article class="gg-article">
        <h3>Active gets (${activeGets.length})</h3>
        ${raw(getsTable)}
      </article>
    </div>

    ${raw(renderListingModals([...activeGives, ...activeGets], user))}
  `;

  return c.html(layout({
    title: "Coordinator",
    user,
    body,
    theme: getTheme(c),
    activeNav: "coord",
    coordNavVisible: getCoordNavVisible(c, user),
  }));
});

// ---------- POST /coord/vouch/:nickname ----------

coordRoutes.post("/coord/vouch/:nickname", (c) => {
  const user = requireCoordinatorDevice(c);
  const target = c.req.param("nickname");
  if (target === user.nickname) throw new HttpError(400, "Coordinators vouch themselves automatically.");
  const u = getUserByNickname(target);
  if (!u) throw new HttpError(404, "User not found.");
  if (u.is_vouched) return c.redirect(`/u/${target}`);
  vouchUser(target, user.nickname);
  return c.redirect(`/u/${target}`);
});

// ---------- POST /coord/unvouch/:nickname ----------

coordRoutes.post("/coord/unvouch/:nickname", (c) => {
  const user = requireCoordinatorDevice(c);
  const target = c.req.param("nickname");
  if (target === user.nickname) throw new HttpError(400, "Can't unvouch yourself.");
  const u = getUserByNickname(target);
  if (!u) throw new HttpError(404, "User not found.");
  unvouchUser(target);
  return c.redirect(`/u/${target}`);
});

// ---------- POST /coord/goodwill/:nickname ----------

coordRoutes.post("/coord/goodwill/:nickname", async (c) => {
  const user = requireCoordinatorDevice(c);
  const target = c.req.param("nickname");
  if (target === user.nickname) throw new HttpError(400, "Coordinators don't grant goodwill to themselves.");
  const u = getUserByNickname(target);
  if (!u) throw new HttpError(404, "User not found.");

  const form = await c.req.formData();
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 1 || reason.length > 200) {
    throw new HttpError(400, "Reason must be 1-200 characters.");
  }

  grantGoodwill(user.nickname, target, reason);
  return c.redirect(`/u/${target}`);
});

// ---------- POST /coord/delete-listing/:id ----------

coordRoutes.post("/coord/delete-listing/:id", (c) => {
  requireCoordinatorDevice(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Bad id.");
  const l = getListingById(id);
  if (!l) throw new HttpError(404, "Listing not found.");
  setListingStatus(id, "deleted");
  return c.redirect("/coord");
});
