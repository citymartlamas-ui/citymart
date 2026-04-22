    import { auth } from './assets/js/firebase-init.js';

    // Auth hint for faster rendering
    if (!localStorage.getItem('userLogedIn')) {
      window.location.replace('login.html');
    }

    auth.onAuthStateChanged((user) => {
      if (!user) {
        localStorage.removeItem('userLogedIn');
        window.location.replace('login.html');
      }
    });
    import { db, auth } from './assets/js/firebase-init.js';
    import { collection, onSnapshot, query, orderBy, limit, getDocs, where, doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

    lucide.createIcons();

    const searchInput = document.getElementById('main-search');
    const searchResults = document.getElementById('search-results');
    const homeContent = document.getElementById('home-content');
    const premiumTrack1 = document.getElementById('carousel-premium-1');
    const premiumTrack2 = document.getElementById('carousel-premium-2');
    const express24hTrack = document.getElementById('carousel-express-24h');
    const express3diasTrack = document.getElementById('carousel-express-3dias');
    const newsTrack = document.getElementById('carousel-news');
    const newBizContainer = document.getElementById('new-businesses');

    let allBusinesses = [];
    let reviewStats = {};

    function transformBizDoc(docSnap) {
      const data = docSnap.data ? docSnap.data() : docSnap;
      const id = docSnap.id || data._id;
      return {
        id: id,
        nombre: data.nombre || "Sin nombre",
        categoria: data.categoria || "Otros",
        descripcion: data.descripcion || "",
        foto: data.foto || data.imagen || "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&q=80&w=600",
        tipo: data.negocio_o_servicio === 'servicio' ? 'service' : 'biz',
        telefono: data.numerodecontacto || data.telefono || "",
        premium: data.promocionanuncio === true,
        visible: data.negociovisible !== false,
        fecha_registro: data.fecha_registro || null
      };
    }

    function init() {
      try {
        loadDailySurvey();
        loadReviewStats();
        loadNegocios();
        loadNews();
      } catch (e) {
        console.error("Error init:", e);
      }
    }

    async function loadNegocios() {
      await CityCache.loadWithCache('negocios',
        async () => {
          const snap = await getDocs(collection(db, "negocio"));
          return snap.docs.map(d => {
            const raw = d.data();
            return { _id: d.id, ...raw };
          });
        },
        (rawData) => {
          allBusinesses = rawData.map(raw => {
            return {
              id: raw._id,
              nombre: raw.nombre || "Sin nombre",
              categoria: raw.categoria || "Otros",
              descripcion: raw.descripcion || "",
              foto: raw.foto || raw.imagen || "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&q=80&w=600",
              tipo: raw.negocio_o_servicio === 'servicio' ? 'service' : 'biz',
              telefono: raw.numerodecontacto || raw.telefono || "",
              premium: raw.promocionanuncio === true,
              visible: raw.negociovisible !== false,
              fecha_registro: raw.fecha_registro || null
            };
          }).filter(b => b.visible);

          renderCarousels();
          renderNewBusinesses();
          renderRanking();
        }
      );
    }

    async function loadReviewStats() {
      await CityCache.loadWithCache('resenas',
        async () => {
          const snap = await getDocs(collection(db, "resenas"));
          return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        },
        (reviews) => {
          reviewStats = {};
          reviews.forEach(d => {
            const bizId = d.negocio_id;
            if (!bizId) return;
            if (!reviewStats[bizId]) reviewStats[bizId] = { total: 0, count: 0 };
            reviewStats[bizId].total += Number(d.puntuacion || 0);
            reviewStats[bizId].count += 1;
          });
          if (allBusinesses.length > 0) renderRanking();
        }
      );
    }

    function renderRanking() {
      const rankingContainer = document.getElementById('ranking-container');

      // Calcular score real por negocio usando datos de reseñas
      const rankedData = allBusinesses.map(b => {
        const stats = reviewStats[b.id];
        const avgScore = stats ? (stats.total / stats.count) : 0;
        const reviewCount = stats ? stats.count : 0;
        // Score combinado: (avgScore * 1000) + reviewCount
        // Esto garantiza que CADA DÉCIMA de estrella pese más que muchísimas reseñas.
        const combinedScore = (avgScore * 1000) + reviewCount;
        return { ...b, avgScore, reviewCount, combinedScore };
      });

      // Solo mostrar negocios que tienen al menos 1 reseña
      const ranked = rankedData
        .filter(b => b.reviewCount > 0)
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, 5);

      if (ranked.length === 0) {
        rankingContainer.innerHTML = '<p style="text-align: center; padding: 10px; color: #999; font-size: 0.8rem;">Aún no hay negocios con reseñas. ¡Sé el primero en calificar!</p>';
        return;
      }

      rankingContainer.innerHTML = ranked.map((b, i) => {
        const score = b.avgScore.toFixed(1);
        const starsFull = Math.round(b.avgScore);
        const medals = ['🥇', '🥈', '🥉', '4', '5'];

        return `
          <div onclick="window.location.href='business_detail.html?id=${b.id}'"
            style="display: flex; align-items: center; justify-content: space-between; padding: 6px 4px; border-bottom: ${i < ranked.length - 1 ? '1px solid #eee' : 'none'}; cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <span style="font-family: 'Outfit'; font-weight: 900; font-size: 0.95rem; width: 24px; color: ${i < 3 ? 'var(--primary-color)' : '#9ca3af'};">
                ${medals[i]}
              </span>
              <h3 style="font-size: 0.85rem; font-weight: 700; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;">${b.nombre}</h3>
            </div>
            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              <span style="color: #fbbf24; font-size: 0.8rem;">★</span>
              <span style="font-weight: 800; font-size: 0.8rem; color: #1f2937;">${score}</span>
              <span style="font-size: 0.65rem; color: #9ca3af; margin-left: 2px;">(${b.reviewCount})</span>
            </div>
          </div>
        `;
      }).join('');
      lucide.createIcons();
    }

    // Fisher-Yates shuffle para mezclar arrays
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    function renderCarousels() {
      // Tomar negocios premium, mezclarlos y dividir en 2 filas
      const premium = shuffle(allBusinesses.filter(b => b.premium));
      const half = Math.ceil(premium.length / 2);
      const row1 = premium.slice(0, half);
      const row2 = premium.slice(half);

      if (row1.length > 0) {
        let html1 = '';
        row1.forEach((b, i) => {
          html1 += `
            <div class="card card-premium-square" onclick="window.location.href='business_detail.html?id=${b.id}'">
              <img src="${b.foto}" class="img-full" loading="lazy">
              <div class="badge-premium-star">⭐</div>
              <div class="overlay-text">
                <h3 style="font-size: 0.6rem; margin-bottom: 1px; font-family: 'Outfit'; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${b.nombre}</h3>
                <p style="font-size: 0.45rem; opacity: 0.9;">${b.categoria}</p>
              </div>
            </div>
          `;
          if ((i + 1) % 5 === 0) {
            html1 += `
              <div class="card card-premium-square" style="background: #f3f4f6; display: flex; align-items: center; justify-content: center;">
                <ins class="adsbygoogle"
                     style="display:inline-block;width:100px;height:100px"
                     data-ad-client="ca-pub-6211692359872996"
                     data-ad-slot="premium_carousel"></ins>
                <script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>
              </div>
            `;
          }
        });
        premiumTrack1.innerHTML = html1;
        autoScroll(premiumTrack1);
      }

      if (row2.length > 0) {
        let html2 = '';
        row2.forEach((b, i) => {
          html2 += `
            <div class="card card-premium-square" onclick="window.location.href='business_detail.html?id=${b.id}'">
              <img src="${b.foto}" class="img-full" loading="lazy">
              <div class="badge-premium-star">⭐</div>
              <div class="overlay-text">
                <h3 style="font-size: 0.6rem; margin-bottom: 1px; font-family: 'Outfit'; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${b.nombre}</h3>
                <p style="font-size: 0.45rem; opacity: 0.9;">${b.categoria}</p>
              </div>
            </div>
          `;
          if ((i + 1) % 5 === 0) {
            html2 += `
              <div class="card card-premium-square" style="background: #f3f4f6; display: flex; align-items: center; justify-content: center;">
                <ins class="adsbygoogle"
                     style="display:inline-block;width:100px;height:100px"
                     data-ad-client="ca-pub-6211692359872996"
                     data-ad-slot="premium_carousel_2"></ins>
                <script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>
              </div>
            `;
          }
        });
        premiumTrack2.innerHTML = html2;
        autoScroll(premiumTrack2);
      } else if (row1.length > 0) {
        // Fallback or duplicate some if only one row? No, better just leave it.
      }

      loadPromos();
    }

    async function loadPromos() {
      await CityCache.loadWithCache('promociones',
        async () => {
          const snap = await getDocs(collection(db, "promociones"));
          return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        },
        (allPromos) => {
          const promos = allPromos.filter(p => p.estado === 'aprobado');
          const p24h = promos.filter(p => p.duracion_dias === 1 || p.duracion === '24h' || (!p.duracion_dias && !p.duracion));
          const p3d = promos.filter(p => p.duracion_dias >= 2 || p.duracion === '3dias' || p.tipo === '3dias');

          const hash24h = JSON.stringify(p24h.map(p => p.id));
          const hash3d = JSON.stringify(p3d.map(p => p.id));

          if (express24hTrack.dataset.lastHash !== hash24h) {
            renderExpressPromos(p24h, express24hTrack, 'expira');
            express24hTrack.dataset.lastHash = hash24h;
          }
          if (express3diasTrack.dataset.lastHash !== hash3d) {
            renderExpressPromos(p3d, express3diasTrack, 'activa');
            express3diasTrack.dataset.lastHash = hash3d;
          }
        }
      );
    }

    function renderExpressPromos(list, container, type) {
      if (list.length === 0) {
        container.innerHTML = '<p style="padding: 20px; opacity: 0.5; font-size: 0.8rem;">Próximamente más ofertas.</p>';
        return;
      }

      list = shuffle(list);
      let html = '';
      list.forEach((p, i) => {
        const d = p.duracion_dias || (p.duracion === '3dias' ? 3 : 1);
        const statusText = d === 1 ? 'EXPIRA 24H' : `ACTIVA ${d} DÍAS`;
        const timerClass = d === 1 ? 'promo-timer' : '';
        // Mejora detección: Solo es video si tiene extensión de video o contiene 'video' o fue detectado como tal en el upload
        const isVideo = p.imagen && (p.imagen.includes('.mp4') || p.imagen.includes('video/') || p.imagen.includes('.mov') || p.imagen.includes('.webm') || p.tipo === 'video');

        html += `
          <div class="card card-promo-express" onclick="window.location.href='promo_detail.html?id=${p.id}'">
            ${isVideo ? `<video src="${p.imagen}" class="img-full" autoplay loop muted playsinline preload="metadata"></video>` : `<img src="${p.imagen}" class="img-full" loading="lazy">`}
            <div class="badge-status ${type} ${timerClass}" data-expire="${p.fechaExpiracion ? p.fechaExpiracion.seconds : ''}">${statusText}</div>
            <div class="overlay-text">
              <h3 style="font-size: 0.6rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Outfit'; margin-bottom: 1px;">${p.precio_oferta ? 'S/ ' + p.precio_oferta.toString().replace(/^S\/\s*/i, '') + ' - ' : ''}${p.titulo}</h3>
              <p style="font-size: 0.45rem; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.nombre_negocio || 'Oferta'}</p>
            </div>
          </div>`;

        if ((i + 1) % 5 === 0) {
          html += `
            <div class="card card-promo-express" style="background: #f3f4f6; display: flex; align-items: center; justify-content: center;">
              <ins class="adsbygoogle"
                   style="display:inline-block;width:110px;height:150px"
                   data-ad-client="ca-pub-6211692359872996"
                   data-ad-slot="promo_carousel"></ins>
              <script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>
            </div>
          `;
        }
      });
      container.innerHTML = html;
      autoScroll(container);
      if (type === 'expira') startTimers();
    }

    function startTimers() {
      const timers = Array.from(document.querySelectorAll('.badge-status[data-expire]'));
      if (timers.length === 0) return;

      const update = () => {
        const now = Date.now();
        let activeTimers = false;

        timers.forEach(t => {
          const expireSeconds = parseInt(t.getAttribute('data-expire'));
          if (!expireSeconds) return;

          activeTimers = true;
          const expireTime = expireSeconds * 1000;
          const diff = expireTime - now;

          if (diff <= 0) {
            t.innerText = 'EXPIRADO';
            t.style.background = '#6b7280';
            return;
          }

          const hours = Math.floor((diff / 3600000) % 24);
          const minutes = Math.floor((diff / 60000) % 60);
          const seconds = Math.floor((diff / 1000) % 60);

          if (diff > 86400000) {
            const days = Math.floor(diff / 86400000);
            t.innerText = `ACTIVA ${days}D ${hours}H`;
          } else {
            const hStr = hours.toString().padStart(2, '0');
            const mStr = minutes.toString().padStart(2, '0');
            const sStr = seconds.toString().padStart(2, '0');
            t.innerText = `EXPIRA ${hStr}:${mStr}:${sStr}`;

            if (diff < 3600000) {
              t.style.background = (seconds % 2 === 0) ? '#ef4444' : '#b91c1c';
            }
          }
        });

        if (activeTimers) setTimeout(update, 1000);
      };

      update();
    }

    function renderPromoFallbacks() {
      const examples = [
        { id: 'ex1', titulo: "2x1 Almuerzos", negocio: "La Casona", img: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=400" },
        { id: 'ex2', titulo: "20% en Cafés", negocio: "Kawsay Coffee", img: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&q=80&w=400" }
      ];
      promosTrack.innerHTML = examples.map(ex => `
        <div class="card" style="width: 260px; height: 160px;" onclick="window.location.href='promo_detail.html?id=${ex.id}'">
          <img src="${ex.img}" class="img-full" loading="lazy">
          <div class="overlay-text" style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
              <h3 style="font-size: 0.9rem;">S/ 15.00 - ${ex.titulo}</h3>
              <p style="font-size: 0.7rem;">${ex.negocio}</p>
            </div>
            <div style="background: var(--secondary-color); color: #fff; padding: 4px 10px; border-radius: 6px; font-weight: 900; font-size: 0.65rem;">
              OFERTA
            </div>
          </div>
        </div>
      `).join('');
      autoScroll(promosTrack);
    }

    function performSearch(term) {
      if (!term || term.trim() === "") {
        searchResults.style.display = 'none';
        homeContent.style.display = 'block';
        return;
      }

      homeContent.style.display = 'none';
      searchResults.style.display = 'flex';

      const filtered = allBusinesses.filter(b =>
        b.nombre.toLowerCase().includes(term.toLowerCase()) ||
        b.categoria.toLowerCase().includes(term.toLowerCase()) ||
        b.descripcion.toLowerCase().includes(term.toLowerCase())
      );

      if (filtered.length === 0) {
        searchResults.innerHTML = '<p style="text-align: center; padding: 40px; color: #666;">No se encontraron resultados.</p>';
      } else {
        searchResults.innerHTML = filtered.map(b => {
          const btn = b.tipo === 'service'
            ? `<button onclick="event.stopPropagation(); window.location.href='tel:${b.telefono}'" style="background: var(--primary-color); color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 0.75rem;">Llamar</button>`
            : `<button onclick="event.stopPropagation(); window.location.href='https://wa.me/51${b.telefono}'" style="background: #25d366; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 0.75rem;">WhatsApp</button>`;

          return `
            <div class="card" style="height: 240px; flex-shrink: 0;" onclick="window.location.href='business_detail.html?id=${b.id}'">
              <img src="${b.foto}" class="img-full">
              <div class="overlay-text" style="display: flex; justify-content: space-between; align-items: flex-end; padding: 15px;">
                <div style="text-align: left;">
                  <h3 style="font-size: 1.1rem;">${b.nombre}</h3>
                  <p style="font-size: 0.8rem; opacity: 0.9;">${b.descripcion}</p>
                </div>
                ${btn}
              </div>
            </div>
          `;
        }).join('');
      }
      lucide.createIcons();
    }

    // Listeners
    searchInput.oninput = (e) => performSearch(e.target.value);

    // Al presionar Enter, también buscar (por si acaso)
    searchInput.onkeypress = (e) => {
      if (e.key === 'Enter') performSearch(e.target.value);
    };
    // --- Noticias de Lamas ---
    async function loadNews() {
      try {
        await CityCache.loadWithCache('noticias',
          async () => {
            const snap = await getDocs(collection(db, "noticias"));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
          },
          (allNews) => {
            const approvedNews = allNews.filter(n => n.estado === 'aprobado');
            if (approvedNews.length > 0) {
              const newHash = JSON.stringify(approvedNews.map(n => n.id));
              if (newsTrack.dataset.lastHash === newHash) return;
              newsTrack.dataset.lastHash = newHash;

              const shuffledNews = shuffle(approvedNews).slice(0, 6);
              newsTrack.innerHTML = shuffledNews.map(n => `
                <div class="card card-news" onclick="window.location.href='news_detail.html?id=${n.id}'">
                  <img src="${n.imagen || 'https://images.unsplash.com/photo-1504711434969-e33886168d6c?auto=format&fit=crop&q=80&w=400'}" class="img-full" loading="lazy">
                  <div class="overlay-text">
                    <span style="background: var(--primary-color); color: white; font-size: 0.6rem; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">${n.categoria || 'Lamas'}</span>
                    <h3 style="font-size: 0.9rem; line-height: 1.25; margin-top: 6px;">${n.titulo || 'Noticia'}</h3>
                  </div>
                </div>`).join('');
              autoScroll(newsTrack);
            } else {
              renderNewsFallback();
            }
          }
        );
      } catch (e) {
        renderNewsFallback();
      }
    }

    function renderNewsFallback() {
      const fallback = [
        { titulo: "Feria Artesanal de Lamas este fin de semana", categoria: "Eventos", img: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&q=80&w=400" },
        { titulo: "Nuevo mirador turístico inaugura en la Provincia", categoria: "Turismo", img: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&q=80&w=400" },
        { titulo: "CityMart Lamas supera los 100 negocios registrados", categoria: "Comunidad", img: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&q=80&w=400" }
      ];
      newsTrack.innerHTML = fallback.map((n, i) => `
        <div class="card" style="width: 280px; height: 180px;" onclick="window.location.href='news.html'">
          <img src="${n.img}" class="img-full" loading="lazy">
          <div class="overlay-text">
            <span style="background: var(--primary-color); color: white; font-size: 0.6rem; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">${n.categoria}</span>
            <h3 style="font-size: 0.9rem; line-height: 1.25; margin-top: 6px;">${n.titulo}</h3>
          </div>
        </div>
      `).join('');
    }

    // --- Recién Llegados (últimos 4 negocios) ---
    function renderNewBusinesses() {
      // Ordenar por fecha_registro (más reciente primero) y tomar los 5 más nuevos
      const recent = [...allBusinesses]
        .sort((a, b) => {
          const dateA = a.fecha_registro?.seconds || 0;
          const dateB = b.fecha_registro?.seconds || 0;
          return dateB - dateA;
        })
        .slice(0, 5);

      if (recent.length === 0) {
        newBizContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: #999; font-size: 0.9rem;">Pronto verás negocios nuevos aquí.</p>';
        return;
      }
      newBizContainer.innerHTML = recent.map(b => {
        // Calcular hace cuánto se registró
        let tiempoTexto = 'Nuevo';
        if (b.fecha_registro?.seconds) {
          const ahora = Date.now();
          const registro = b.fecha_registro.seconds * 1000;
          const diffHoras = Math.floor((ahora - registro) / (1000 * 60 * 60));
          if (diffHoras < 1) tiempoTexto = 'Hace minutos';
          else if (diffHoras < 24) tiempoTexto = `Hace ${diffHoras}h`;
          else if (diffHoras < 48) tiempoTexto = 'Ayer';
          else {
            const diffDias = Math.floor(diffHoras / 24);
            tiempoTexto = diffDias <= 30 ? `Hace ${diffDias} días` : 'Nuevo';
          }
        }
        return `
        <div onclick="window.location.href='business_detail.html?id=${b.id}'" 
          style="display: flex; align-items: center; gap: 14px; background: #fff; padding: 12px; border-radius: 16px; border: 1px solid #f0f0f0; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <div style="width: 65px; height: 65px; border-radius: 14px; overflow: hidden; flex-shrink: 0;">
            <img src="${b.foto}" alt="${b.nombre}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">
          </div>
          <div style="flex: 1; min-width: 0;">
            <h4 style="font-family: 'Outfit'; font-weight: 800; font-size: 0.95rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${b.nombre}</h4>
            <p style="font-size: 0.75rem; color: #6b7280; margin-bottom: 4px;">${b.categoria}</p>
            <span style="background: #dcfce7; color: #166534; font-size: 0.6rem; font-weight: 700; padding: 2px 8px; border-radius: 4px;">${tiempoTexto.toUpperCase()}</span>
          </div>
          <i data-lucide="chevron-right" style="color: #d1d5db; width: 20px; flex-shrink: 0;"></i>
        </div>
      `}).join('');
      lucide.createIcons();
    }

    function autoScroll(el) {
      if (!el || el._isScrolling) return;
      el._isScrolling = true;
      const section = el.closest('section');
      const dotsContainer = section ? section.querySelector('.carousel-dots') : null;
      const dots = dotsContainer ? Array.from(dotsContainer.querySelectorAll('.dot')) : [];

      setTimeout(() => {
        if (el.scrollWidth <= el.clientWidth) {
          if (dotsContainer) dotsContainer.style.display = 'none';
          return;
        }

        const maxScroll = el.scrollWidth - el.clientWidth;
        el.scrollLeft = Math.floor(Math.random() * maxScroll);

        let paused = false;
        let scrollPos = el.scrollLeft;
        let lastIdx = -1;
        const SPEED = 0.6; // Suave

        const step = () => {
          if (!paused) {
            scrollPos += SPEED;
            if (scrollPos >= maxScroll) scrollPos = 0;
            el.scrollLeft = scrollPos;

            // Actualizar dots con baja frecuencia
            if (dots.length > 0) {
              const idx = Math.min(Math.floor((scrollPos / maxScroll) * dots.length), dots.length - 1);
              if (idx !== lastIdx) {
                dots.forEach((d, i) => d.classList.toggle('active', i === idx));
                lastIdx = idx;
              }
            }
          }
          requestAnimationFrame(step);
        };

        requestAnimationFrame(step);

        el.addEventListener('touchstart', () => { paused = true; }, { passive: true });
        el.addEventListener('touchend', () => {
          setTimeout(() => {
            paused = false;
            scrollPos = el.scrollLeft;
          }, 2500);
        }, { passive: true });
        el.addEventListener('mouseenter', () => { paused = true; });
        el.addEventListener('mouseleave', () => {
          paused = false;
          scrollPos = el.scrollLeft;
        });
      }, 1500);
    }

    init();

    auth.onAuthStateChanged((user) => {
      const btn = document.getElementById('auth-btn');
      if (btn) {
        if (user) {
          btn.style.background = '#f3f4f6';
          btn.style.color = '#4b5563';
          btn.style.padding = '4px 10px';
          btn.style.border = '1px solid #e5e7eb';
          btn.style.boxShadow = 'none';

          btn.innerHTML = `
            <span style="font-size: 0.6rem; font-weight: 900; letter-spacing: 0.02em;">MI PERFIL</span>
            <div style="width: 24px; height: 24px; border-radius: 50%; overflow: hidden; background: #ddd; display: flex; align-items: center; justify-content: center;">
              ${user.photoURL ?
              `<img src="${user.photoURL}" style="width: 100%; height: 100%; object-fit: cover;">` :
              `<i data-lucide="user" style="width: 12px; height: 12px; color: #9ca3af;"></i>`}
            </div>
          `;
          btn.onclick = () => window.location.href = 'profile.html';
          lucide.createIcons();
        } else {
          btn.style.background = 'var(--primary-color)';
          btn.style.color = 'white';
          btn.style.padding = '8px 16px';
          btn.style.border = 'none';
          btn.style.boxShadow = '0 4px 12px rgba(11, 89, 242, 0.2)';
          btn.innerHTML = 'INGRESAR';
          btn.onclick = () => window.location.href = 'login.html';
        }
      }
    });

    function escapeHtml(unsafe) {
      return (unsafe || "").toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Lógica para Estudio de Mercado dinamica con Firebase (basado en encuestas)
    async function loadDailySurvey() {
      const surveySection = document.getElementById("daily-survey-section");
      if (!surveySection) return;

      try {
        const allEncuestas = await CityCache.loadWithCache('encuestas',
          async () => {
            const snap = await getDocs(collection(db, "encuestas_diarias"));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
          },
          () => { } // renderizado se hace abajo
        );

        const aprobadas = (allEncuestas || []).filter(d => d.estado === 'aprobado');

        if (aprobadas.length === 0) {
          surveySection.style.display = 'none';
          return;
        }

        // Ordenar por fecha más reciente
        aprobadas.sort((a, b) => {
          const fa = a.fecha_creacion?.seconds || 0;
          const fb = b.fecha_creacion?.seconds || 0;
          return fb - fa;
        });

        const data = aprobadas[0];
        const surveyId = data.id;
        surveySection.style.display = 'block';

        const opciones = data.opciones || [];
        let totalVotos = data.total_votos || 0;
        let totalForPct = totalVotos === 0 ? 1 : totalVotos;

        const gradientColors = [
          "#3b82f6", // azul corporativo
          "#6366f1", // índigo
          "#4f46e5", // azul oscuro
          "#2563eb"  // azul brillante
        ];
        const textColors = ["#2563eb", "#4f46e5", "#3730a3", "#1d4ed8"];

        let hasVotedLocally = localStorage.getItem('encuesta_votada_' + surveyId);

        let optionsHtml = opciones.map((op, idx) => {
          let votos = op.votos || 0;
          let pct = Math.round((votos / totalForPct) * 100);
          let gColor = gradientColors[idx % gradientColors.length];
          let tColor = textColors[idx % textColors.length];

          let isMyVote = hasVotedLocally === String(idx) || (hasVotedLocally === "true" && idx === 0);

          let checkIcon = hasVotedLocally ?
            (isMyVote ? `<i data-lucide="check-circle-2" style="width: 16px; height: 16px; color: ${tColor}; flex-shrink: 0;"></i>` : `<span style="width: 16px; height: 16px; flex-shrink: 0;"></span>`) :
            `<div style="width: 16px; height: 16px; border: 1.5px solid #d1d5db; border-radius: 50%; flex-shrink: 0; transition: all 0.2s;"></div>`;

          return `
            <div onclick="${hasVotedLocally ? '' : `window.voteSurvey('${surveyId}', ${idx})`}" style="cursor: ${hasVotedLocally ? 'default' : 'pointer'}; position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; font-size: 0.8rem; font-weight: 700; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                  ${checkIcon}
                  <span style="color: #374151; line-height: 1.2;">${escapeHtml(op.texto)}</span>
                </div>
                <span style="color: ${tColor}; margin-left: 8px;">${votos}</span>
              </div>
              <div style="background: #f3f4f6; border-radius: 8px; height: 10px; overflow: hidden; margin-left: 24px;">
                <div style="background: ${gColor}; width: ${pct}%; height: 100%; border-radius: 8px; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
              </div>
            </div>
          `;
        }).join("");

        surveySection.innerHTML = `
          <div style="background: #ffffff; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); border: 1px solid #f3f4f6;">
            <!-- Encabezado Patrocinador -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <img src="${data.patrocinador_foto || data.foto_creador || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" alt="Creador" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; box-shadow: 0 2px 6px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
                <div>
                  <span style="font-size: 0.6rem; color: #6b7280; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; display: block; margin-bottom: -1px;">Creado por</span>
                  <span style="font-family: 'Outfit'; font-weight: 700; font-size: 0.95rem; color: #111; display: block; line-height: 1.1;">${escapeHtml(data.patrocinador_nombre || data.nombre_creador || 'Usuario')}</span>
                </div>
              </div>
              <div style="background: #1e293b; color: #f8fafc; padding: 4px 10px; border-radius: 4px; font-size: 0.55rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; flex-shrink: 0;">
                 ESTUDIO DE MERCADO
              </div>
            </div>

            <!-- Pregunta -->
            <h3 style="font-size: 1.05rem; font-weight: 900; color: #1f2937; margin-bottom: 12px; line-height: 1.25;">${escapeHtml(data.pregunta)}</h3>

            <!-- Opciones con Barras -->
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${optionsHtml}
            </div>

            <!-- Total Votos -->
            <div style="text-align: right; margin-top: 8px;">
              <span style="font-size: 0.6rem; color: #9ca3af; font-weight: 700; text-transform: uppercase;">Total votos: ${totalVotos}</span>
            </div>
          </div>
        `;

        setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 10);

      } catch (err) {
        console.error("[Encuesta] Error cargando encuesta diaria:", err);
        if (surveySection) surveySection.style.display = 'none';
      }
    }

    window.voteSurvey = async function (surveyId, index) {
      if (localStorage.getItem('encuesta_votada_' + surveyId)) {
        return;
      }

      try {
        const docRef = doc(db, "encuestas_diarias", surveyId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;

        let data = snap.data();
        let opciones = data.opciones || [];
        if (!opciones[index]) return;
        opciones[index].votos = (opciones[index].votos || 0) + 1;
        let total = (data.total_votos || 0) + 1;

        await updateDoc(docRef, {
          opciones: opciones,
          total_votos: total
        });

        localStorage.setItem('encuesta_votada_' + surveyId, String(index));
        CityCache.invalidate('encuestas');

      } catch (e) {
        console.error(e);
        showToast('Hubo un error al procesar tu voto. Inténtalo de nuevo.', 'error');
      }
    };

    // --- Lógica de Sugerencias ---
    import { addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

    window.toggleSuggestionModal = function (show) {
      const modal = document.getElementById('suggestion-modal');
      if (show) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
      } else {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
      }
    };

    window.selectTag = function (el) {
      document.querySelectorAll('.suggestion-tag').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    };

    window.saveSuggestion = async function () {
      const text = document.getElementById('suggestion-text').value;
      const tag = document.querySelector('.suggestion-tag.selected')?.innerText || 'General';
      const btn = document.getElementById('btn-submit-suggestion');

      if (!text || text.trim().length < 5) {
        return showToast('¡Cuéntanos un poco más sobre tu idea!', 'error');
      }

      try {
        btn.disabled = true;
        btn.innerText = "ENVIANDO...";

        await addDoc(collection(db, "sugerencias"), {
          uid: auth.currentUser?.uid || 'anonimo',
          usuario: auth.currentUser?.displayName || 'Usuario',
          email: auth.currentUser?.email || '',
          texto: text,
          categoria: tag,
          timestamp: new Date(),
          estado: 'nueva'
        });

        btn.style.background = '#10b981';
        btn.innerText = "¡IDEA RECIBIDA! ✨";

        setTimeout(() => {
          window.toggleSuggestionModal(false);
          document.getElementById('suggestion-text').value = '';
          btn.disabled = false;
          btn.innerText = "ENVIAR MI IDEA";
          btn.style.background = 'linear-gradient(135deg, #111, #333)';
        }, 2000);

      } catch (e) {
        console.error(e);
        showToast('No pudimos enviar tu idea. Intenta de nuevo.', 'error');
        btn.disabled = false;
        btn.innerText = "ENVIAR MI IDEA";
      }
    };

    // Mostrar el FAB solo cuando el usuario esté cargado
    auth.onAuthStateChanged((user) => {
      if (user) {
        const fab = document.getElementById('suggestions-fab-container');
        if (fab) fab.style.display = 'flex';
        lucide.createIcons();
      }
    });

    // Service Worker - registro normal
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
      });
    }
