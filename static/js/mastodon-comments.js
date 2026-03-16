/**
 * mastodon-comments.js
 * Busca replies, boosts e favoritos de um toot via API pública do Mastodon
 * e renderiza na seção de comentários do artigo.
 *
 * Sem dependências externas. Funciona com qualquer instância Mastodon/Fediverse
 * que exponha a API pública (a grande maioria).
 */

(function () {
  "use strict";

  const section = document.getElementById("mastodon-comments");
  if (!section) return;

  const host   = section.dataset.host;
  const tootId = section.dataset.tootId;

  if (!host || !tootId) return;

  const listEl    = document.getElementById("masto-comment-list");
  const statsEl   = document.getElementById("masto-stats");
  const loadingEl = document.getElementById("masto-loading");

  // ─── Utilitários ─────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", {
      day:   "2-digit",
      month: "short",
      year:  "numeric",
    });
  }

  // Extrai o @handle@instância do account
  function acct(account) {
    if (account.acct.includes("@")) return "@" + account.acct;
    return "@" + account.acct + "@" + host;
  }

  // ─── Fetch ───────────────────────────────────────────────────────────────────

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
  }

  async function loadComments() {
    try {
      const [statusData, contextData] = await Promise.all([
        fetchJson(`https://${host}/api/v1/statuses/${tootId}`),
        fetchJson(`https://${host}/api/v1/statuses/${tootId}/context`),
      ]);

      renderStats(statusData);
      renderComments(contextData.descendants || []);
    } catch (err) {
      console.error("[mastodon-comments]", err);
      if (loadingEl) {
        loadingEl.textContent =
          "Não foi possível carregar os comentários. Tente recarregar a página.";
      }
    }
  }

  // ─── Renderização ─────────────────────────────────────────────────────────────

  function renderStats(status) {
    if (!statsEl) return;

    const replies  = status.replies_count  || 0;
    const reblogs  = status.reblogs_count  || 0;
    const favourites = status.favourites_count || 0;

    statsEl.innerHTML = `
      <span class="masto-stat">
        <span class="masto-stat__icon" aria-hidden="true">💬</span>
        <strong>${replies}</strong> resposta${replies !== 1 ? "s" : ""}
      </span>
      <span class="masto-stat">
        <span class="masto-stat__icon" aria-hidden="true">🔁</span>
        <strong>${reblogs}</strong> boost${reblogs !== 1 ? "s" : ""}
      </span>
      <span class="masto-stat">
        <span class="masto-stat__icon" aria-hidden="true">⭐</span>
        <strong>${favourites}</strong> favorito${favourites !== 1 ? "s" : ""}
      </span>
    `;
  }

  function renderComments(descendants) {
    if (!listEl) return;

    // Remove o loading
    if (loadingEl) loadingEl.remove();

    // Filtra apenas replies diretas ao toot raiz (não threads aninhadas)
    // Se quiser mostrar toda a thread, remova o filtro abaixo.
    const directReplies = descendants.filter(
      (s) => s.in_reply_to_id === tootId
    );

    if (directReplies.length === 0) {
      listEl.innerHTML =
        '<p class="masto-comment__empty">Nenhum comentário ainda. Seja o primeiro — responda ao toot!</p>';
      return;
    }

    const fragment = document.createDocumentFragment();

    directReplies.forEach((status) => {
      const article = buildComment(status);
      fragment.appendChild(article);
    });

    listEl.appendChild(fragment);
  }

  function buildComment(status) {
    const account = status.account;

    const article = document.createElement("article");
    article.className = "masto-comment";
    article.setAttribute("aria-label", `Comentário de ${account.display_name}`);

    // Avatar
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "masto-comment__avatar-wrap";

    const avatarLink = document.createElement("a");
    avatarLink.href = account.url;
    avatarLink.target = "_blank";
    avatarLink.rel = "noopener noreferrer";
    avatarLink.setAttribute("aria-label", account.display_name);

    const avatarImg = document.createElement("img");
    avatarImg.className = "masto-comment__avatar";
    // Usa avatar_static para evitar GIFs animados que poluem a página
    avatarImg.src = account.avatar_static || account.avatar;
    avatarImg.alt = escapeHtml(account.display_name);
    avatarImg.loading = "lazy";
    avatarImg.width = 44;
    avatarImg.height = 44;

    avatarLink.appendChild(avatarImg);
    avatarWrap.appendChild(avatarLink);

    // Header
    const header = document.createElement("div");
    header.className = "masto-comment__header";

    const authorLink = document.createElement("a");
    authorLink.className = "masto-comment__author";
    authorLink.href = account.url;
    authorLink.target = "_blank";
    authorLink.rel = "noopener noreferrer";
    authorLink.textContent = account.display_name || account.username;

    const handleSpan = document.createElement("span");
    handleSpan.className = "masto-comment__handle";
    handleSpan.textContent = acct(account);

    const dateLink = document.createElement("a");
    dateLink.className = "masto-comment__date";
    dateLink.href = status.url;
    dateLink.target = "_blank";
    dateLink.rel = "noopener noreferrer";
    dateLink.textContent = formatDate(status.created_at);
    dateLink.title = new Date(status.created_at).toLocaleString("pt-BR");

    header.appendChild(authorLink);
    header.appendChild(handleSpan);
    header.appendChild(dateLink);

    // Body — o Mastodon retorna HTML sanitizado; exibimos como innerHTML
    // (conteúdo vem da API pública, não do usuário do seu site)
    const body = document.createElement("div");
    body.className = "masto-comment__body";
    body.innerHTML = status.content;

    // Reactions inline do comentário (opcionais, mas úteis)
    const reactions = document.createElement("div");
    reactions.className = "masto-comment__reactions";

    if (status.reblogs_count > 0) {
      reactions.innerHTML += `<span>🔁 ${status.reblogs_count}</span>`;
    }
    if (status.favourites_count > 0) {
      reactions.innerHTML += `<span>⭐ ${status.favourites_count}</span>`;
    }

    article.appendChild(avatarWrap);
    article.appendChild(header);
    article.appendChild(body);
    if (reactions.innerHTML) article.appendChild(reactions);

    return article;
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  // Usa IntersectionObserver para só buscar quando a seção entrar na viewport
  // Evita requisições desnecessárias para quem não rola até o fim do artigo
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadComments();
            obs.disconnect();
          }
        });
      },
      { rootMargin: "200px" }
    );
    observer.observe(section);
  } else {
    // Fallback para navegadores sem suporte (raro hoje)
    loadComments();
  }
})();