(() => {
  const SERVICE_HOST = ["tik", "wm.com"].join("");
  const SOURCE_HOST  = ["tik", "tok.com"].join("");
  const PROXY_BASE     = "https://doomsroll.detlaffcameron.workers.dev";

  let useProxy = localStorage.getItem("platypus-proxy") === "1";

  function apiBaseList() {
    return useProxy
      ? [PROXY_BASE]
      : [`https://www.${SERVICE_HOST}/api`, `https://${SERVICE_HOST}/api`];
  }
  const SERVICE_ORIGIN = `https://www.${SERVICE_HOST}`;
  const SOURCE_ORIGIN  = `https://www.${SOURCE_HOST}`;
  const FILLER_TERMS = ["fyp","viral","funny","meme","storytime","gaming","edit","music","animals","food"];

  const feed           = document.getElementById("feed");
  const apiDot         = document.getElementById("apiDot");
  const regionSelect   = document.getElementById("region");
  const drawer         = document.getElementById("commentsDrawer");
  const backdrop       = document.getElementById("backdrop");
  const commentsList   = document.getElementById("commentsList");
  const commentsTitle  = document.getElementById("commentsTitle");
  const profileDrawer  = document.getElementById("profileDrawer");
  const profileContent = document.getElementById("profileContent");
  const profileTitle   = document.getElementById("profileTitle");

  let videos   = [];
  let ids      = new Set();
  let activeIndex   = 0;
  let renderedCount = 0;
  let loading  = false;
  let batches  = 0;
  let soundOn  = true;
  let observer = null;
  let activeFeedElement = null;
  let liked = new Set(JSON.parse(localStorage.getItem("platypus-liked") || "[]"));
  let saved = new Set(JSON.parse(localStorage.getItem("platypus-saved") || "[]"));
  let profileReturnToComments = false;
  let currentProfileUsername  = "";

  const fmt = n => {
    n = Number(n || 0);
    if (n >= 1e9) return (n/1e9).toFixed(n >= 1e10 ? 0 : 1).replace(".0","") + "B";
    if (n >= 1e6) return (n/1e6).toFixed(n >= 1e7  ? 0 : 1).replace(".0","") + "M";
    if (n >= 1e3) return (n/1e3).toFixed(n >= 1e4  ? 0 : 1).replace(".0","") + "K";
    return String(n || 0);
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const persist = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));
  const toast = t => {
    const e = document.getElementById("toast");
    e.textContent = t;
    e.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => e.classList.remove("show"), 1900);
  };

  function guessRegion() {
    const lang = (navigator.language || "en-US").split("-")[1];
    if (lang && [...regionSelect.options].some(o => o.value === lang)) regionSelect.value = lang;
  }

  async function fetchWithTimeout(url, options = {}, timeout = 14000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function validApiJson(j) {
    if (!j || typeof j !== "object") throw new Error("Invalid response");
    if (Number(j.code) !== 0) throw new Error(j.msg || "Feed error");
    return j.data;
  }

  async function api(path, params = {}) {
    let lastErr;
    for (const base of apiBaseList()) {
      try {
        const u = new URL(base + path);
        for (const [k, v] of Object.entries(params))
          if (v !== undefined && v !== null) u.searchParams.set(k, v);
        const r = await fetchWithTimeout(u, {
          method: "GET", mode: "cors", cache: "no-store",
          headers: { "Accept": "application/json,text/plain,*/*" }
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = validApiJson(await r.json());
        apiDot.className = "api-dot ok";
        return data;
      } catch (e) { lastErr = e; }
    }
    apiDot.className = "api-dot bad";
    throw lastErr || new Error("Feed unavailable");
  }

  function normalize(v) {
    const a = v.author || {}, m = v.music_info || v.music || {};
    const id = String(v.video_id || v.id || "");
    let play   = v.hdplay || v.play || v.wmplay || v.download_addr || "";
    let cover  = v.cover  || v.origin_cover || v.ai_dynamic_cover || "";
    let avatar = a.avatar || a.avatarThumb  || a.avatar_thumb || "";
    try { if (play)   play   = new URL(play,   SERVICE_ORIGIN).href; } catch {}
    try { if (cover)  cover  = new URL(cover,  SERVICE_ORIGIN).href; } catch {}
    try { if (avatar) avatar = new URL(avatar, SERVICE_ORIGIN).href; } catch {}
    return {
      id, play, cover,
      title:        v.title || v.desc || "PlatypusScroll video",
      duration:     Number(v.duration    || 0),
      createTime:   Number(v.create_time || 0),
      playCount:    Number(v.play_count  || 0),
      likeCount:    Number(v.digg_count  || 0),
      commentCount: Number(v.comment_count || 0),
      shareCount:   Number(v.share_count || 0),
      username:     a.unique_id || a.uniqueId || v.author_unique_id || "platypus",
      nickname:     a.nickname  || a.unique_id || "Creator",
      avatar,
      musicTitle:   m.title  || "Original audio",
      musicAuthor:  m.author || a.nickname || a.unique_id || ""
    };
  }

  function addItems(items) {
    let added = 0;
    for (const raw of (items || [])) {
      const v = normalize(raw);
      if (!v.id || !v.play || ids.has(v.id)) continue;
      ids.add(v.id); videos.push(v); added++;
    }
    return added;
  }

  function icon(name) {
    return {
      play:    `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#f0f0f0"/></svg>`,
      heart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 8.6c0 5.3-8.8 11.2-8.8 11.2S3.2 13.9 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/></svg>`,
      comment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 11.2a8.4 8.4 0 0 1-9 8.3 9.7 9.7 0 0 1-3.4-.9L3 20l1.5-4.7A8.3 8.3 0 1 1 20.5 11.2Z"/></svg>`,
      save:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3.5h12v17l-6-4-6 4z"/></svg>`,
      share:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 3 3.8 10.1c-1 .4-.9 1.9.2 2.1l7 1.5 1.7 6.3c.3 1.1 1.8 1.2 2.2.2z"/><path d="m11 13.7 4-4"/></svg>`
    }[name];
  }

  function avatarHTML(v) {
    return v.avatar
      ? `<img class="avatar" loading="lazy" src="${esc(v.avatar)}" alt="">`
      : `<div class="avatar-fallback">${esc(v.username.slice(0,2).toUpperCase())}</div>`;
  }

  function reelMarkup(v, i) {
    return `<section class="reel paused" data-index="${i}" data-id="${esc(v.id)}">
      <div class="video-wrap">
        <div class="cover-blur" style="background-image:url('${esc(v.cover)}')"></div>
        <video playsinline loop preload="metadata" poster="${esc(v.cover)}" src="${esc(v.play)}"></video>
        <div class="shade"></div>
        <div class="tap"></div>
        <div class="play-indicator">${icon("play")}</div>
      </div>
      <div class="meta">
        <div class="userline"><strong>@${esc(v.username)}</strong></div>
        <div class="caption">${esc(v.title)}</div>
        <div class="music-line">♪ <span>${esc(v.musicTitle)}${v.musicAuthor ? " · " + esc(v.musicAuthor) : ""}</span></div>
      </div>
      <div class="actions">
        <button class="action" data-profile="${esc(v.username)}">${avatarHTML(v)}</button>
        <button class="action ${liked.has(v.id) ? "liked" : ""}" data-like="${esc(v.id)}">
          <span class="bubble">${icon("heart")}</span>
          <span>${liked.has(v.id) ? "Liked" : fmt(v.likeCount)}</span>
        </button>
        <button class="action" data-comment="${esc(v.id)}">
          <span class="bubble">${icon("comment")}</span>
          <span>${fmt(v.commentCount)}</span>
        </button>
        <button class="action ${saved.has(v.id) ? "liked" : ""}" data-save="${esc(v.id)}">
          <span class="bubble">${icon("save")}</span>
          <span>${saved.has(v.id) ? "Saved" : "Save"}</span>
        </button>
        <button class="action" data-share="${esc(v.id)}">
          <span class="bubble">${icon("share")}</span>
          <span>${fmt(v.shareCount) || "Share"}</span>
        </button>
        <div class="disc"></div>
      </div>
      <div class="progress"><i></i></div>
    </section>`;
  }

  function appendNewCards() {
    const frag = document.createDocumentFragment();
    while (renderedCount < videos.length) {
      const i = renderedCount, v = videos[i];
      const holder = document.createElement("div");
      holder.innerHTML = reelMarkup(v, i).trim();
      frag.appendChild(holder.firstElementChild);
      renderedCount++;
    }
    feed.appendChild(frag);
    bindNewCards();
    observeNewCards();
  }

  function bindNewCards() {
    feed.querySelectorAll(".reel:not([data-bound])").forEach(r => {
      r.dataset.bound = "1";
      const v = r.querySelector("video");
      r.querySelector(".tap").onclick = () => toggle(r);
      v.addEventListener("timeupdate", () => {
        if (v.duration) r.querySelector(".progress i").style.width = ((v.currentTime / v.duration) * 100) + "%";
      });
      r.querySelector("[data-like]").onclick = () => {
        const id = r.dataset.id;
        liked.has(id) ? liked.delete(id) : liked.add(id);
        persist("platypus-liked", liked);
        const b = r.querySelector("[data-like]");
        b.classList.toggle("liked", liked.has(id));
        b.lastElementChild.textContent = liked.has(id) ? "Liked" : fmt(videos.find(x => x.id === id)?.likeCount);
      };
      r.querySelector("[data-save]").onclick = () => {
        const id = r.dataset.id;
        saved.has(id) ? saved.delete(id) : saved.add(id);
        persist("platypus-saved", saved);
        const b = r.querySelector("[data-save]");
        b.classList.toggle("liked", saved.has(id));
        b.lastElementChild.textContent = saved.has(id) ? "Saved" : "Save";
        toast(saved.has(id) ? "Saved" : "Removed");
      };
      r.querySelector("[data-comment]").onclick = () => openComments(r.dataset.id);
      r.querySelector("[data-share]").onclick   = () => shareVideo(r.dataset.id);
      r.querySelector("[data-profile]").onclick = () => openProfile(r.querySelector("[data-profile]").dataset.profile, false);
    });
  }

  function setupObserver() {
    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio > .72) {
          activeFeedElement = e.target;
          if (e.target.classList.contains("reel")) {
            activeIndex = Number(e.target.dataset.index);
            activate(activeIndex);
            if (activeIndex >= videos.length - 4) loadMore(false);
          }
        } else if (e.target.classList.contains("reel") && !e.isIntersecting) {
          e.target.querySelector("video")?.pause();
          e.target.classList.add("paused");
        }
      }
    }, { root: feed, threshold: [.2, .72, .9] });
  }

  function observeNewCards() {
    if (!observer) setupObserver();
    feed.querySelectorAll(".reel:not([data-observed])").forEach(el => {
      el.dataset.observed = "1";
      observer.observe(el);
    });
  }

  function pauseAll(except = null) {
    feed.querySelectorAll(".reel").forEach(r => {
      if (r !== except) { r.querySelector("video")?.pause(); r.classList.add("paused"); }
    });
  }

  function activate(i, force = false) {
    const r = feed.querySelector(`.reel[data-index="${i}"]`);
    if (!r) return;
    pauseAll(r);
    const v = r.querySelector("video");
    v.muted = !soundOn;
    if (force || v.paused) v.play().then(() => r.classList.remove("paused")).catch(() => r.classList.add("paused"));
  }

  function toggle(r) {
    const v = r.querySelector("video");
    if (v.paused) {
      pauseAll(r); v.muted = !soundOn;
      v.play().then(() => r.classList.remove("paused")).catch(() => {});
    } else {
      v.pause(); r.classList.add("paused");
    }
  }

  async function loadMore(reset = false) {
    if (loading) return;
    loading = true;
    if (reset) {
      pauseAll();
      videos = []; ids.clear(); activeIndex = 0; renderedCount = 0; batches = 0;
      feed.innerHTML = `<div class="loader-reel" id="initialLoader"><div><div class="spinner"></div><p style="color:#555;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">Loading</p></div></div>`;
    }
    try {
      let added = 0;
      const data = await api("/feed/list", { region: regionSelect.value, count: 20 });
      added += addItems(Array.isArray(data) ? data : (data?.videos || []));
      if (added < 5) {
        const endpoint = "/feed/" + ["se","arch"].join("");
        const term = FILLER_TERMS[batches % FILLER_TERMS.length];
        const extra = await api(endpoint, { keywords: term, count: 20, cursor: (batches * 20), web: 1 });
        added += addItems(extra?.videos || []);
      }
      batches++;
      document.getElementById("initialLoader")?.remove();
      appendNewCards();
      if (!videos.length) throw new Error("No playable videos returned");
      if (reset) setTimeout(() => activate(0, true), 120);
    } catch (e) {
      console.error(e);
      if (!videos.length) {
        feed.innerHTML = `<div class="loader-reel"><div class="errorbox"><h2>Feed unavailable</h2><div>${esc(e.message)}</div><button id="retryFeed">Try again</button></div></div>`;
        document.getElementById("retryFeed")?.addEventListener("click", () => loadMore(true));
      } else {
        toast("Couldn't load more videos");
      }
    } finally {
      loading = false;
    }
  }

  async function openComments(id) {
    const v = videos.find(x => x.id === id);
    commentsTitle.textContent = v ? `${fmt(v.commentCount)} comments` : "Comments";
    commentsList.innerHTML = `<div style="text-align:center;padding:32px;color:#555"><div class="spinner"></div></div>`;
    profileDrawer.classList.remove("open");
    drawer.classList.add("open");
    backdrop.classList.add("open");
    try {
      const data = await api("/comment/list", { url: id, count: 30, cursor: 0 });
      const cs = data?.comments || [];
      commentsList.innerHTML = cs.length
        ? cs.map(c => {
            const u = c.user || {};
            const username = u.unique_id || u.uniqueId || u.nickname || "user";
            let avatar = u.avatar || u.avatar_thumb || u.avatarThumb || "";
            try { if (avatar) avatar = new URL(avatar, SERVICE_ORIGIN).href; } catch {}
            const av = avatar
              ? `<img src="${esc(avatar)}" alt="">`
              : `<div class="cavi">${esc(username.slice(0,2).toUpperCase())}</div>`;
            return `<div class="comment">
              <button class="comment-user" data-comment-profile="${esc(username)}">
                ${av}
                <div class="ctext">
                  <b>@${esc(username)}</b>
                  ${esc(c.text || "")}
                  <small>♥ ${fmt(c.digg_count)} · ${fmt(c.reply_total)} replies</small>
                </div>
              </button>
            </div>`;
          }).join("")
        : `<div style="padding:32px;text-align:center;color:#555;font-size:13px">No public comments.</div>`;
      commentsList.querySelectorAll("[data-comment-profile]").forEach(btn => {
        btn.addEventListener("click", () => openProfile(btn.dataset.commentProfile, true));
      });
    } catch {
      commentsList.innerHTML = `<div style="padding:32px;text-align:center;color:#555;font-size:13px">Couldn't load comments.</div>`;
    }
  }

  function closeComments() {
    drawer.classList.remove("open");
    if (!profileDrawer.classList.contains("open")) backdrop.classList.remove("open");
  }

  function profileAvatarURL(user) {
    const raw = user?.avatarLarger || user?.avatarMedium || user?.avatarThumb || user?.avatar || "";
    if (!raw) return "";
    try { return new URL(raw, SERVICE_ORIGIN).href; } catch { return raw; }
  }

  function closeProfile() {
    profileDrawer.classList.remove("open");
    if (profileReturnToComments) {
      drawer.classList.add("open"); backdrop.classList.add("open");
      profileReturnToComments = false;
    } else if (!drawer.classList.contains("open")) {
      backdrop.classList.remove("open");
    }
  }

  async function openProfile(username, fromComments = false) {
    username = String(username || "").replace(/^@/, "").trim();
    if (!username) return;
    currentProfileUsername = username;
    profileReturnToComments = !!fromComments;
    drawer.classList.remove("open");
    profileTitle.textContent = "@" + username;
    profileContent.innerHTML = `<div class="profile-loading"><div class="spinner"></div>Loading profile</div>`;
    profileDrawer.classList.add("open");
    backdrop.classList.add("open");

    const [detailResult, postsResult] = await Promise.allSettled([
      api("/user/info",  { unique_id: username }),
      api("/user/posts", { unique_id: username, count: 30, cursor: "0" })
    ]);
    if (currentProfileUsername !== username) return;

    const detail   = detailResult.status === "fulfilled" ? (detailResult.value || {}) : {};
    const postData = postsResult.status  === "fulfilled" ? (postsResult.value  || {}) : {};
    const user     = detail.user  || {};
    const stats    = detail.stats || {};
    const rawPosts = Array.isArray(postData) ? postData : (postData.videos || []);
    const posts    = rawPosts.map(normalize).filter(p => p.id && (p.cover || p.play));

    const handle   = user.uniqueId || user.unique_id || username;
    const nickname = user.nickname || handle;
    const avatar   = profileAvatarURL(user) || posts.find(p => p.avatar)?.avatar || "";
    const bio      = user.signature || "";
    const verified = !!user.verified;

    const avHTML = avatar
      ? `<img class="profile-big-avatar" src="${esc(avatar)}" alt="">`
      : `<div class="profile-big-fallback">${esc(handle.slice(0,2).toUpperCase())}</div>`;

    const grid = posts.length
      ? posts.map(p => `
          <button class="profile-post" data-profile-post="${esc(p.id)}" title="${esc(p.title)}">
            <img src="${esc(p.cover)}" alt="" loading="lazy">
            <span class="profile-post-shade">▶ ${fmt(p.playCount)}</span>
          </button>`).join("")
      : `<div class="profile-empty" style="grid-column:1/-1">No recent posts.</div>`;

    profileContent.innerHTML = `
      <div class="profile-hero">
        <div class="profile-identity">
          ${avHTML}
          <div class="profile-names">
            <h2>${esc(nickname)}${verified ? '<span class="verified">✓</span>' : ""}</h2>
            <div class="handle">@${esc(handle)}</div>
          </div>
        </div>
        <div class="profile-stats">
          <div class="profile-stat"><b>${fmt(stats.followerCount)}</b><span>Followers</span></div>
          <div class="profile-stat"><b>${fmt(stats.followingCount)}</b><span>Following</span></div>
          <div class="profile-stat"><b>${fmt(stats.heartCount || stats.heart)}</b><span>Likes</span></div>
        </div>
        ${bio ? `<div class="profile-bio">${esc(bio)}</div>` : ""}
      </div>
      <div class="profile-posts-head"><span>Posts</span><span>${fmt(stats.videoCount || posts.length)}</span></div>
      <div class="profile-grid">${grid}</div>`;

    profileContent.querySelectorAll("[data-profile-post]").forEach(btn => {
      btn.addEventListener("click", () => {
        const post = posts.find(p => p.id === btn.dataset.profilePost);
        if (!post) return;
        let index = videos.findIndex(v => v.id === post.id);
        if (index < 0) { ids.add(post.id); videos.push(post); appendNewCards(); index = videos.length - 1; }
        profileReturnToComments = false;
        closeProfile();
        feed.querySelector(`.reel[data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => activate(index, true), 250);
      });
    });

    if (detailResult.status === "rejected" && postsResult.status === "rejected") {
      profileContent.innerHTML = `<div class="profile-empty"><b style="display:block;color:#f0f0f0;margin-bottom:6px">Profile unavailable</b>Couldn't load this creator.</div>`;
    }
  }

  async function shareVideo(id) {
    const v = videos.find(x => x.id === id);
    if (!v) return;
    const url = String(`${SOURCE_ORIGIN}/@${v.username}/video/${v.id}`);
    try {
      if (navigator.share) await navigator.share({ title: String(v.title || ""), url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch {}
  }

  function toggleSound() {
    soundOn = !soundOn;
    const v = feed.querySelector(`.reel[data-index="${activeIndex}"] video`);
    if (v) v.muted = !soundOn;
    document.querySelector("#soundBtn span").textContent = soundOn ? "Sound on" : "Sound off";
    toast(soundOn ? "Sound on" : "Sound off");
  }

  // ── BINDINGS ──
  document.getElementById("homeBtn").onclick    =
  document.getElementById("mHome").onclick      = () => feed.scrollTo({ top: 0, behavior: "smooth" });
  document.getElementById("refreshBtn").onclick =
  document.getElementById("mRefresh").onclick   = () => loadMore(true);
  document.getElementById("soundBtn").onclick   =
  document.getElementById("mSound").onclick     = toggleSound;
  document.getElementById("aboutBtn").onclick   =
  document.getElementById("mAbout").onclick     = () => toast("PlatypusScroll 🦆");
  document.getElementById("applyRegion").onclick = () => {
    toast("Region: " + regionSelect.options[regionSelect.selectedIndex].text);
    loadMore(true);
  };
  document.getElementById("shuffleBtn").onclick = () => {
    pauseAll();
    videos.sort(() => Math.random() - .5);
    renderedCount = 0; feed.innerHTML = "";
    appendNewCards(); feed.scrollTo({ top: 0 });
    setTimeout(() => activate(0, true), 120);
  };
  document.getElementById("closeComments").onclick = closeComments;
  document.getElementById("closeProfile").onclick  = closeProfile;
  backdrop.onclick = () => {
    profileReturnToComments = false;
    profileDrawer.classList.remove("open");
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
  };

  window.addEventListener("keydown", e => {
    if (drawer.classList.contains("open") || profileDrawer.classList.contains("open")) return;
    if (["ArrowDown","PageDown","ArrowUp","PageUp"].includes(e.key)) {
      e.preventDefault();
      const cards = [...feed.querySelectorAll(".reel")];
      if (!cards.length) return;
      let current = activeFeedElement && cards.includes(activeFeedElement) ? cards.indexOf(activeFeedElement) : 0;
      const delta = (e.key === "ArrowDown" || e.key === "PageDown") ? 1 : -1;
      cards[Math.max(0, Math.min(cards.length - 1, current + delta))]?.scrollIntoView({ behavior: "smooth" });
    }
    if (e.key === " " && !/SELECT/.test(document.activeElement.tagName)) {
      const r = activeFeedElement?.classList.contains("reel")
        ? activeFeedElement
        : feed.querySelector(`.reel[data-index="${activeIndex}"]`);
      if (r) { e.preventDefault(); toggle(r); }
    }
  });


  // ── PROXY TOGGLE ──
  function syncProxyBtn() {
    const btn = document.getElementById("proxyToggle");
    if (!btn) return;
    btn.textContent = useProxy ? "Disable proxy" : "Enable proxy";
    btn.className   = useProxy ? "btn btn-primary" : "btn btn-ghost";
    btn.style.width = "100%";
  }
  syncProxyBtn();
  document.getElementById("proxyToggle")?.addEventListener("click", () => {
    useProxy = !useProxy;
    localStorage.setItem("platypus-proxy", useProxy ? "1" : "0");
    syncProxyBtn();
    toast(useProxy ? "Proxy enabled" : "Proxy disabled");
    loadMore(true);
  });

  guessRegion();
  setupObserver();
  loadMore(true);
})();
