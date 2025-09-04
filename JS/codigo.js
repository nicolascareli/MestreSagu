// ==============================
// Mestre Sagu - JS principal
// ==============================
console.log("Mestre Sagu site carregado 🎸🤘");

// ==============================
// CONFIG
// ==============================
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSR968DhqhfY_79bsKR_diVD-1OZ0kgjNUL5LXTvrk-0JUXL9xt-8LXXyh_73tB7doPXnwq1RCeMFf_/pub?gid=733115468&single=true&output=csv";

const LIMIT_DESKTOP = 6; // quantos cards na vitrine desktop
const LIMIT_CAROUSEL = 6; // quantos slides no carrossel mobile

// IDs de elementos esperados no HTML
const IDS = {
    desktopGrid: "agendaDesktopStatic",
    mobileIndicators: "agendaIndicatorsMobile",
    mobileSlides: "agendaSlidesMobile",
    listContainer: "agendaList",
    modalId: "agendaModal",
    modalList: "agendaCompletaList"
};

// Cache em memória para reuso (ex.: modal)
let AGENDA_UPCOMING = [];

// ==============================
// NAVBAR: comportamento ao rolar
// ==============================
(function() {
    const nav = document.querySelector(".nav-main");

    function onScroll() {
        if (!nav) return;
        if (window.scrollY >= 100) nav.classList.add("scrolled");
        else nav.classList.remove("scrolled");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    // link ativo simples
    document.querySelectorAll(".nav-main .nav-link").forEach(link => {
        link.addEventListener("click", () => {
            document.querySelectorAll(".nav-main .nav-link").forEach(l => l.classList.remove("active"));
            link.classList.add("active");
        });
    });
})();

// ==============================
// UTILS: datas/horas e CSV
// ==============================
const TZ = "America/Sao_Paulo";

// Agora na TZ de SP (data + hora)
function nowInSaoPaulo() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return new Date(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, 0, 0);
}

// "dd/mm/aaaa" ou "dd-mm-aaaa"
function parseDateBR(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return null;
    let [, dd, mm, yyyy] = m;
    dd = +dd;
    mm = +mm - 1;
    yyyy = (String(yyyy).length === 2 ? 2000 + +yyyy : +yyyy);
    const d = new Date(yyyy, mm, dd);
    return isNaN(d.getTime()) ? null : d;
}

// "aaaa-mm-dd"
function parseDateISO(str) {
    const m = String(str || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
}

// aceita "HH:mm" ou "H:mm"
function parseTimeBR(str) {
    const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: 0, m: 0 };
    let [, h, mi] = m;
    h = Math.min(23, Math.max(0, +h));
    mi = Math.min(59, Math.max(0, +mi));
    return { h, m: mi };
}

// junta data + hora; se hora faltar → 00:00
function combineDateTime(dateObj, timeStr) {
    if (!dateObj) return null;
    const { h, m } = parseTimeBR(timeStr);
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), h, m, 0, 0);
}

// CSV parser robusto (aspas, vírgulas, quebras CRLF)
function parseCSV(text) {
    if (!text || !text.trim()) return [];
    const rows = [];
    let row = [],
        field = "",
        inQ = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i],
            n = text[i + 1];
        if (c === '"' && n === '"') {
            field += '"';
            i++;
            continue;
        }
        if (c === '"') { inQ = !inQ; continue; }
        if (!inQ && c === ",") {
            row.push(field);
            field = "";
            continue;
        }
        if (!inQ && (c === "\n" || c === "\r")) {
            if (field !== "" || row.length) {
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            }
            if (c === "\r" && n === "\n") i++;
            continue;
        }
        field += c;
    }
    if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
    }

    if (!rows.length) return [];
    const headers = rows.shift().map(h => String(h).trim());
    return rows
        .filter(r => r && r.length && r.some(v => String(v).trim() !== ""))
        .map(cols => {
            const o = {};
            headers.forEach((h, i) => o[h] = (cols[i] || "").toString().trim());
            return o;
        });
}

// normaliza chaves para aceitar EN/PT
const norm = s => String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");

// pega valor por aliases de chave (ex.: ["date","Data"])
function pick(obj, aliases) {
    const keys = Object.keys(obj);
    const map = new Map(keys.map(k => [norm(k), k]));
    for (const a of aliases) {
        const nk = norm(a);
        if (map.has(nk)) return obj[map.get(nk)];
    }
    // fallback: começa com (útil pra "Dia da semana" ~ "dia")
    for (const k of keys) {
        if (norm(k).startsWith(norm(aliases[0]))) return obj[k];
    }
    return "";
}

// ==============================
// FORMATADORES VISUAIS
// ==============================
function formatDayMonthShort(d) {
    const day = String(d.getDate()).padStart(2, "0");
    const mon = d.toLocaleString("pt-BR", { month: "short" }).toUpperCase();
    const wkd = d.toLocaleString("pt-BR", { weekday: "short" }); // seg., ter., ...
    return { day, mon, wkd };
}

function monthLabelPT(d) {
    const label = d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDateBR(d) {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function weekdayLong(d) {
    return new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(d); // segunda-feira
}

// ==============================
// TEMPLATES (cards/lista)
// ==============================
function createCard(ev) {
    const { day, mon, wkd } = formatDayMonthShort(ev._date);
    const hora = ev.time ? `${ev.time}h` : "";
    const meta = [wkd, hora, ev.venue, ev.address].filter(Boolean).join(" • ");
    const title = ev.title || `${ev.venue || ""}`.trim();

    return `
    <article class="agenda-card h-80 p-4 y-4">
      <div class="d-flex align-items-center gap-3 mb-2 p-1">
        <div class="date-badge text-center">
          <span class="day d-block">${day}</span>
          <span class="mon d-block">${mon}</span>
        </div>
        <div class="flex-grow-1">
          <h3 class="h5 m-0">${title}</h3>
          <small class="text-muted">${meta}</small>
        </div>
      </div>
    </article>
  `;
}

function createListItem(ev) {
    const dBR = formatDateBR(ev._date);
    const wkd = weekdayLong(ev._date);
    const hora = ev.time ? `${ev.time}` : "";
    const meta = [wkd, hora].filter(Boolean).join(" • ");
    const loc = [ev.venue, ev.address].filter(Boolean).join(" — ");
    const title = ev.title || "";

    return `
    <li class="agenda-item">
      <strong>${title || dBR}</strong><br>
      <small>${[dBR, meta].filter(Boolean).join(" — ")} ${loc ? "— " + loc : ""}</small>
    </li>
  `;
}

// ==============================
// RENDER (desktop, mobile, lista, modal)
// ==============================
function renderDesktopStatic(events) {
    const cont = document.getElementById(IDS.desktopGrid);
    if (!cont) return;
    const first = events.slice(0, LIMIT_DESKTOP);
    cont.innerHTML = first.map(ev => `<div class="col-md-4">${createCard(ev)}</div>`).join("");
}

function renderMobileCarousel(events) {
    const ind = document.getElementById(IDS.mobileIndicators);
    const slidesEl = document.getElementById(IDS.mobileSlides);
    if (!ind || !slidesEl) return;

    const list = events.slice(0, LIMIT_CAROUSEL);
    ind.innerHTML = list.map((_, i) =>
        `<button type="button" data-bs-target="#agendaCarouselMobile" data-bs-slide-to="${i}" class="${i === 0 ? "active" : ""}" ${i === 0 ? 'aria-current="true"' : ""} aria-label="Slide ${i + 1}"></button>`
    ).join("");

    slidesEl.innerHTML = list.map((ev, i) =>
        `<div class="carousel-item ${i === 0 ? "active" : ""}">${createCard(ev)}</div>`
    ).join("");
}

function renderList(events) {
    const container = document.getElementById(IDS.listContainer);
    if (!container) return;

    // agrupa por mês/ano
    const groups = new Map();
    events.forEach(ev => {
        const key = monthLabelPT(ev._date);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ev);
    });

    const html = Array.from(groups.entries()).map(([mes, arr]) => `
    <section class="agenda-month">
      <h4 class="month-title">${mes}</h4>
      <ul class="month-list">
        ${arr.map(createListItem).join("")}
      </ul>
    </section>
  `).join("");

    container.innerHTML = html;
}

function renderAgendaModal(events) {
    const cont = document.getElementById(IDS.modalList);
    if (!cont) return;

    if (!events.length) {
        cont.innerHTML = `
      <div class="text-muted">
        Nenhum show futuro encontrado agora.<br>
        <small>(Se você acabou de atualizar a planilha, pode levar alguns minutos para o CSV publicar.)</small>
      </div>`;
        return;
    }

    // agrupa por mês/ano
    const groups = new Map();
    events.forEach(ev => {
        const key = monthLabelPT(ev._date);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ev);
    });

    let html = "";
    for (const [mes, arr] of groups) {
        html += `<h5 style="text-transform:capitalize;margin:1rem 0 .5rem">${mes}</h5>`;
        for (const ev of arr) {
            const linha1 = [
                formatDateBR(ev._date),
                weekdayLong(ev._date),
                ev.time ? `${ev.time}` : ""
            ].filter(Boolean).join(" • ");
            const linha2 = [ev.title, ev.venue, ev.address].filter(Boolean).join(" — ");
            html += `
        <div class="agenda-item" style="border:1px solid rgba(255,255,255,.08);border-radius:.5rem;padding:.75rem .9rem;background:#121218;margin-bottom:.5rem">
          <div class="agenda-title" style="font-weight:700;margin-bottom:.25rem">${linha2 || ev.title || "Evento"}</div>
          <p class="agenda-meta" style="color:#cfcfd6;font-size:.95rem;margin:0">${linha1}</p>
        </div>`;
        }
    }
    cont.innerHTML = html;
}

// ==============================
// PIPELINE: carregar, normalizar, filtrar, renderizar
// ==============================
async function loadAgenda() {
    const res = await fetch(`${SHEET_URL}&cb=${Date.now()}`); // fura cache
    const csv = await res.text();
    const rows = parseCSV(csv);

    // mapeia linhas do CSV → objeto normalizado
    let events = rows.map(r => {
        // Cabeçalhos EN (preferidos) + fallbacks PT
        const dateTxt = pick(r, ["date", "Data", "data"]);
        const timeTxt = pick(r, ["time", "Horário", "Horario", "hora", "Hora"]);
        const title = pick(r, ["title", "Título", "Titulo"]);
        const venue = pick(r, ["venue", "Local", "local"]);
        const address = pick(r, ["address", "Endereço", "Endereco"]);

        // data aceita ISO (aaaa-mm-dd) e BR (dd/mm/aaaa)
        let d = parseDateISO(dateTxt) || parseDateBR(dateTxt);
        if (!d) return null;

        const dtFull = combineDateTime(d, timeTxt); // se não tiver hora, vira 00:00
        const ref = dtFull || d;

        return {
            dateRaw: dateTxt || "",
            time: timeTxt || "",
            title: title || "",
            venue: venue || "",
            address: address || "",
            _date: d, // Date (meia-noite)
            _ref: ref // Date (data+hora se houver)
        };
    }).filter(Boolean);

    // filtro: só futuro (>= agora SP), ordena asc
    const nowSP = nowInSaoPaulo();
    events = events
        .filter(ev => ev._ref >= nowSP)
        .sort((a, b) => a._ref - b._ref);

    // guarda pro modal reutilizar sem novo fetch
    AGENDA_UPCOMING = events;

    // renders
    renderDesktopStatic(events);
    renderMobileCarousel(events);
    renderList(events);
}

// carrega ao abrir a página
loadAgenda().catch(err => console.error("Erro ao carregar agenda:", err));

// ==============================
// MODAL: carrega/usa a lista já processada
// ==============================
(function setupAgendaModal() {
    const modalEl = document.getElementById(IDS.modalId);
    if (!modalEl) return;

    let rendered = false;
    modalEl.addEventListener("show.bs.modal", async() => {
        try {
            if (!AGENDA_UPCOMING.length) {
                // fallback: se ainda não carregou, carrega
                await loadAgenda();
            }
            if (!rendered) {
                renderAgendaModal(AGENDA_UPCOMING);
                rendered = true;
            }
        } catch (e) {
            console.error("Agenda modal error:", e);
            const cont = document.getElementById(IDS.modalList);
            if (cont) cont.innerHTML = `<p class="text-danger">Erro ao carregar a agenda. Tente novamente.</p>`;
        }
    });
})();

// ==============================
// (Opcional) Atualização automática:
// Revalida a agenda a cada 10 minutos
// ==============================
// setInterval(() => {
//   loadAgenda().catch(console.error);
// }, 600000);


// ===== BEGIN: MEMBERS (SYNC GRID -> MOBILE CAROUSEL) =====
(function syncMembersToCarousel() {
    // Seleciona a grade desktop e o carrossel mobile
    const grid = document.querySelector('.members-grid'); // desktop grid (d-none d-md-grid)
    const ind = document.getElementById('membersIndicators'); // mobile indicators
    const slides = document.getElementById('membersSlides'); // mobile slides
    const carousel = document.getElementById('membersCarousel');

    if (!grid || !ind || !slides || !carousel) return; // nada a fazer se faltar algo

    // Captura todos os "cards" de integrante no desktop
    const cards = Array.from(grid.querySelectorAll('.member-card'));
    if (!cards.length) return;

    // Limpa containers do mobile (caso já tenham algo)
    ind.innerHTML = '';
    slides.innerHTML = '';

    // Monta indicadores e slides com base nos cards
    cards.forEach((card, i) => {
        // Indicadores (bolinhas)
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-bs-target', '#membersCarousel');
        btn.setAttribute('data-bs-slide-to', String(i));
        btn.setAttribute('aria-label', `Integrante ${i + 1}`);
        if (i === 0) {
            btn.classList.add('active');
            btn.setAttribute('aria-current', 'true');
        }
        ind.appendChild(btn);

        // Slide
        const item = document.createElement('div');
        item.className = 'carousel-item' + (i === 0 ? ' active' : '');
        // Reaproveita o HTML do card desktop, mas envolve com um article para manter o padding/estilo
        const wrapper = document.createElement('article');
        wrapper.className = 'member-card mx-3';
        wrapper.innerHTML = card.innerHTML;
        item.appendChild(wrapper);

        slides.appendChild(item);
    });
})();
// ===== END: MEMBERS (SYNC GRID -> MOBILE CAROUSEL) =====


// ===== BEGIN: STATS COUNTER =====
(function setupStatsCounter() {
    const section = document.getElementById('stats');
    if (!section) return;

    const counters = Array.from(section.querySelectorAll('.count'));
    if (!counters.length) return;

    let started = false;
    const easeOut = t => 1 - Math.pow(1 - t, 3); // acelera e desacelera suave

    function animateCounter(el, target, suffix, duration = 1400) {
        const start = performance.now();
        const from = 0;

        function frame(now) {
            const p = Math.min(1, (now - start) / duration);
            const val = Math.round(easeOut(p) * target);
            el.textContent = String(val);
            if (p < 1) requestAnimationFrame(frame);
            else el.textContent = String(target); // valor final
        }
        requestAnimationFrame(frame);

        // aplica o sufixo visual sem atrapalhar a contagem
        if (suffix) {
            const s = document.createElement('span');
            s.textContent = suffix;
            s.style.marginLeft = '2px';
            el.after(s);
        }
    }

    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !started) {
                started = true;
                counters.forEach(el => {
                    const target = parseInt(el.getAttribute('data-target') || '0', 10);
                    const suffix = el.getAttribute('data-suffix') || '';
                    animateCounter(el, target, suffix);
                });
                io.disconnect();
            }
        });
    }, { threshold: 0.35 });

    io.observe(section);
})();
// ===== END: STATS COUNTER =====

// ===== BEGIN: VENUES (loop contínuo sem gaps) =====
(function setupVenuesMarquee() {
    const track = document.getElementById('venuesTrack');
    if (!track) return;
    const wrapper = track.closest('.logos-wrapper') || track.parentElement;

    // 1) mede a largura do conteúdo original
    const originalHTML = track.innerHTML;
    // garante que cada logo não quebre
    track.style.whiteSpace = 'nowrap';

    // aplica uma primeira duplicação
    track.innerHTML = originalHTML + originalHTML;

    // 2) duplica até que metade do trilho seja maior que a área visível (para cobrir a transição)
    const minWidth = wrapper.clientWidth;
    // depois de duplicar uma vez, metade do track é o conteúdo original
    const contentWidth = () => track.scrollWidth / 2;
    let safety = 0;
    while (contentWidth() < minWidth && safety < 8) {
        track.innerHTML += originalHTML; // acrescenta mais um bloco original
        safety++;
    }

    // 3) define a distância EXATA a percorrer (largura do conteúdo original)
    const dist = contentWidth(); // px
    track.style.setProperty('--dist', dist + 'px');

    // 4) ajusta a duração conforme quantidade de logos para uma velocidade agradável
    const logosCount = track.querySelectorAll('.venue-logo').length / (1 + safety); // aprox. total originais
    if (dist <= 1200) {
        track.style.setProperty('--dur', '18s');
    } else if (dist <= 2000) {
        track.style.setProperty('--dur', '24s');
    } else {
        track.style.setProperty('--dur', '30s');
    }

    // Pausa no hover (desktop)
    track.addEventListener('mouseenter', () => track.style.animationPlayState = 'paused');
    track.addEventListener('mouseleave', () => track.style.animationPlayState = 'running');
})();

// ===== BEGIN: VENUES – ticker contínuo via rAF (zero gaps) =====
(function setupVenuesTicker() {
    const track = document.getElementById('venuesTrack');
    if (!track) return;
    const wrapper = track.closest('.logos-wrapper') || track.parentElement;

    // 1) espera as imagens carregarem para medir tudo certinho
    const imgs = Array.from(track.querySelectorAll('img'));
    const waitImgs = Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(res => img.addEventListener('load', res, { once: true }));
    }));

    waitImgs.then(() => {
        // 2) mantém um bloco original e cria um clone para rodízio contínuo
        const original = document.createElement('div');
        original.className = 'venues-block';
        original.innerHTML = track.innerHTML;

        const clone = original.cloneNode(true);

        // Limpa e injeta 2 blocos iguais
        track.innerHTML = '';
        track.appendChild(original);
        track.appendChild(clone);

        // Medidas exatas do bloco original
        function blockWidth() { return original.getBoundingClientRect().width; }

        // 3) loop: move em px/s; quando passar da largura do bloco, reseta sem pulo
        let x = 0;
        let last = performance.now();

        // velocidade: mais rápido em desktop, mais suave no mobile
        function currentSpeed() {
            return window.innerWidth >= 992 ? 60 : 40; // px por segundo
        }

        let paused = false;
        track.addEventListener('mouseenter', () => paused = true);
        track.addEventListener('mouseleave', () => paused = false);

        function tick(now) {
            const dt = (now - last) / 1000;
            last = now;
            if (!paused) {
                x -= currentSpeed() * dt;
                const w = blockWidth();
                if (x <= -w) x += w; // passou um bloco inteiro → reposiciona sem gap
                track.style.transform = `translate3d(${x}px,0,0)`;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);

        // 4) ao redimensionar, recalcula suavemente (sem “trancos”)
        let rto;
        window.addEventListener('resize', () => {
            clearTimeout(rto);
            rto = setTimeout(() => { /* só reseta a posição visualmente */
                const w = blockWidth();
                if (x <= -w) x += w;
                track.style.transform = `translate3d(${x}px,0,0)`;
            }, 120);
        }, { passive: true });
    });
})();
// ===== END: VENUES – ticker contínuo via rAF =====

// ===== END: VENUES =====