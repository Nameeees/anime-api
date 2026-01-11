const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const MI_API_KEY = "super_secreto_123";
const BASE_URL = "https://www3.animeflv.net";

// VARIABLE GLOBAL PARA EL NAVEGADOR
let globalBrowser = null;

// INICIAR NAVEGADOR UNA SOLA VEZ AL ARRANCAR EL SERVIDOR
async function initBrowser() {
    if (!globalBrowser) {
        console.log("🔥 Iniciando Navegador Maestro...");
        globalBrowser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Ahorra memoria en entornos limitados
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        console.log("✅ Navegador listo y en espera.");
    }
    return globalBrowser;
}

// INICIALIZAMOS AL ARRANCAR
initBrowser();

const verificarKey = (req, res, next) => {
    if (req.query.key !== MI_API_KEY) return res.status(403).json({ error: "Key inválida." });
    next();
};

// FUNCIÓN MAESTRA PARA OBTENER PÁGINAS OPTIMIZADAS
async function getPage() {
    const browser = await initBrowser();
    const page = await browser.newPage();

    // OPTIMIZACIÓN CRÍTICA: BLOQUEAR IMÁGENES Y CSS
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            req.abort(); // Bloquear carga
        } else {
            req.continue(); // Permitir HTML y Scripts
        }
    });

    // User Agent real para evitar bloqueos
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    return page;
}

// --- RUTA INICIO ---
app.get('/inicio', verificarKey, async (req, res) => {
    let page;
    try {
        page = await getPage();
        // domcontentloaded es más rápido que networkidle
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

        const data = await page.evaluate((base) => {
            const res = { episodiosRecientes: [], animesRecientes: [] };
            
            // Episodios
            document.querySelectorAll('.ListEpisodios li').forEach(li => {
                const titulo = li.querySelector('.Title')?.innerText;
                const link = li.querySelector('a')?.getAttribute('href');
                const imagen = li.querySelector('img')?.getAttribute('src');
                const capitulo = li.querySelector('.Capi')?.innerText;
                if (titulo) res.episodiosRecientes.push({ titulo, capitulo, url: base + link, imagen: base + imagen });
            });

            // Animes agregados
            document.querySelectorAll('.ListAnimes li').forEach(li => {
                 const titulo = li.querySelector('.Title')?.innerText;
                 const tipo = li.querySelector('.Type')?.innerText;
                 const link = li.querySelector('a')?.getAttribute('href');
                 const img = li.querySelector('img');
                 const imagen = img?.getAttribute('src') || img?.getAttribute('data-cfsrc');
                 if(titulo) res.animesRecientes.push({ titulo, tipo, url: base + link, imagen: base + imagen });
            });

            return res;
        }, BASE_URL);

        res.json({ status: "success", data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (page) await page.close(); // Cerramos la PESTAÑA, no el navegador
    }
});

// --- RUTA BUSCAR ---
app.get('/buscar', verificarKey, async (req, res) => {
    const { q } = req.query;
    let page;
    try {
        page = await getPage();
        await page.goto(`${BASE_URL}/browse?q=${q || ''}`, { waitUntil: 'domcontentloaded' });
        
        const resultados = await page.evaluate((base) => {
            return Array.from(document.querySelectorAll('.ListAnimes li')).map(li => ({
                titulo: li.querySelector('.Title')?.innerText,
                tipo: li.querySelector('.Type')?.innerText,
                url: base + li.querySelector('a')?.getAttribute('href'),
                imagen: li.querySelector('img')?.getAttribute('src')
            }));
        }, BASE_URL);

        res.json({ status: "success", data: resultados });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (page) await page.close();
    }
});

// --- RUTA CATEGORIAS ---
app.get('/categorias', verificarKey, async (req, res) => {
    let page;
    try {
        page = await getPage();
        await page.goto(`${BASE_URL}/browse`, { waitUntil: 'domcontentloaded' });

        const data = await page.evaluate(() => {
            const filtros = { generos: [] };
            const genreSelect = document.querySelector('select[name="genre"]');
            if (genreSelect) {
                genreSelect.querySelectorAll('option').forEach(opt => {
                    if(opt.value && opt.value !== "all") {
                        filtros.generos.push({ nombre: opt.innerText.trim(), valor: opt.value });
                    }
                });
            }
            return filtros;
        });

        res.json({ status: "success", data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (page) await page.close();
    }
});

// --- RUTA INFO ANIME ---
app.get('/info', verificarKey, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Falta URL" });

    let page;
    try {
        page = await getPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const animeData = await page.evaluate(() => {
            const getText = (sel) => document.querySelector(sel)?.innerText.trim() || "";
            const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "";

            const info = {
                titulo: getText('h1.Title'),
                titulo_alt: document.querySelector('span.TxtAlt')?.innerText || "",
                sinopsis: getText('.Description'),
                estado: getText('.AnmStts span'),
                tipo: getText('.Type'),
                rating: getText('#votes_prmd'),
                votos: getText('#votes_nmbr'),
                poster: getAttr('.Image figure img', 'src'),
                banner: "",
                generos: [],
                episodios: []
            };

            const bgElement = document.querySelector('.Bg');
            if (bgElement && bgElement.style.backgroundImage) {
                info.banner = bgElement.style.backgroundImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
            }

            document.querySelectorAll('.Nvgnrs a').forEach(a => info.generos.push(a.innerText));

            const scripts = document.getElementsByTagName('script');
            let listaEpisodiosRaw = [];
            let animeSlug = "";

            for (let script of scripts) {
                if (script.textContent.includes('var episodes =')) {
                    const matchEps = script.textContent.match(/var episodes = (\[.*?\]);/s);
                    const matchInfo = script.textContent.match(/var anime_info = (\[.*?\]);/s);
                    if (matchEps && matchEps[1]) listaEpisodiosRaw = JSON.parse(matchEps[1]);
                    if (matchInfo && matchInfo[1]) animeSlug = JSON.parse(matchInfo[1])[1];
                }
            }

            listaEpisodiosRaw.sort((a, b) => a[0] - b[0]);
            info.episodios = listaEpisodiosRaw.map(ep => ({
                numero: ep[0],
                url: `https://www3.animeflv.net/ver/${animeSlug}-${ep[0]}`
            }));

            return info;
        });

        res.json({ status: "success", data: animeData });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (page) await page.close();
    }
});

// --- RUTA OBTENER LINKS ---
app.get('/obtener-links', verificarKey, async (req, res) => {
    const { url } = req.query;
    let page;
    try {
        page = await getPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const resultado = await page.evaluate(() => {
            const scripts = document.getElementsByTagName('script');
            for (let script of scripts) {
                if (script.textContent.includes('var videos =')) {
                    const match = script.textContent.match(/var videos = (\{.*?\});/s);
                    if (match && match[1]) return JSON.parse(match[1]);
                }
            }
            return null;
        });

        if (resultado) res.json({ status: "success", data: resultado });
        else res.status(404).json({ error: "No videos found" });

    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (page) await page.close();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API Turbo corriendo en http://localhost:${PORT}`);
});