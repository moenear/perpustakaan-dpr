const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const session = require('express-session');
const util = require('util');
const app = express();

// --- 1. KONEKSI DATABASE ---
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'perpustakaan_dpr',
    multipleStatements: true
});

const query = util.promisify(db.query).bind(db);

db.connect((err) => {
    if (err) {
        console.error('Koneksi Gagal:', err.message);
        return;
    }
    console.log('Database Terhubung & Siap!');
});

// --- 2. CONFIG & MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'kunci_rahasia_dpr_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 Jam
}));

// Middleware Anti-Cache
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
    next();
});

// Middleware Proteksi Login
const isLoggedIn = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

// Middleware Khusus Admin
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.send("<script>alert('Akses Ditolak! Anda bukan Admin.'); window.location='/';</script>");
};

// --- 3. FITUR AUTHENTICATION ---

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login');
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const results = await query("SELECT * FROM users WHERE email = ? AND password = ?", [email, password]);
        if (results.length > 0) {
            req.session.user = results[0];
            req.session.save(() => {
                res.redirect('/');
            });
        } else {
            res.send("<script>alert('Email/Password salah!'); window.location='/login';</script>");
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/signup', (req, res) => res.render('signup'));

app.post('/signup', async (req, res) => {
    try {
        const { nama, email, password } = req.body;
        const exist = await query("SELECT id FROM users WHERE email = ?", [email]);
        if (exist.length > 0) {
            return res.send("<script>alert('Email sudah terdaftar!'); window.location='/signup';</script>");
        }
        await query("INSERT INTO users (nama, email, password, role) VALUES (?, ?, ?, 'anggota')", [nama, email, password]);
        res.send("<script>alert('Pendaftaran Berhasil!'); window.location='/login';</script>");
    } catch (err) { res.status(500).send("Gagal mendaftar: " + err.message); }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return console.log(err);
        res.clearCookie('connect.sid'); 
        res.redirect('/login');
    });
});

// --- 4. DASHBOARD USER (Katalog Terbaru 24 Jam) ---
app.get('/', isLoggedIn, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const sql = `
            -- Stats Card
            SELECT (SELECT COUNT(*) FROM buku) as totalBuku, 
                   (SELECT SUM(stok) FROM buku) as stokTersedia,
                   (SELECT COUNT(*) FROM peminjaman WHERE status = 'dipinjam') as sedangDipinjam;
            
            -- Query Buku yang baru ditambahkan dalam 24 jam terakhir
            SELECT * FROM buku 
            WHERE tgl_input >= NOW() - INTERVAL 1 DAY 
            ORDER BY id DESC;

            -- Riwayat Peminjaman User
            SELECT p.*, b.judul, 
                   DATEDIFF(CURDATE(), p.tgl_pinjam) as lama_pinjam,
                   (7 - DATEDIFF(CURDATE(), p.tgl_pinjam)) as sisa_hari
            FROM peminjaman p 
            JOIN buku b ON p.buku_id = b.id 
            WHERE p.user_id = ? 
            ORDER BY p.status DESC, p.tgl_pinjam DESC;
        `;
        const results = await query(sql, [userId]);
        res.render('index', { 
            user: req.session.user, 
            stats: results[0][0], 
            daftarBuku: results[1], 
            riwayatPinjam: results[2] 
        });
    } catch (err) { res.status(500).send(err.message); }
});

// --- 5. HALAMAN KOLEKSI (Menampilkan Semua Buku) ---
app.get('/koleksi', isLoggedIn, async (req, res) => {
    try {
        // Mengambil semua buku dari database tanpa filter waktu
        const results = await query("SELECT * FROM buku ORDER BY judul ASC");
        res.render('koleksi', { 
            user: req.session.user, 
            daftarBuku: results 
        });
    } catch (err) { res.status(500).send(err.message); }
});

// --- 6. FITUR SEARCH, PINJAM & KEMBALI ---

app.get('/search', isLoggedIn, async (req, res) => {
    try {
        const q = req.query.q;
        const results = await query("SELECT * FROM buku WHERE judul LIKE ? OR penulis LIKE ?", [`%${q}%`, `%${q}%`]);
        res.json(results);
    } catch (err) { res.status(500).json([]); }
});

app.post('/pinjam/:id', isLoggedIn, async (req, res) => {
    try {
        const bukuId = req.params.id;
        const userId = req.session.user.id;
        
        const cek = await query("SELECT id FROM peminjaman WHERE user_id = ? AND buku_id = ? AND status = 'dipinjam'", [userId, bukuId]);
        if (cek.length > 0) return res.send("<script>alert('Anda sudah meminjam buku ini!'); window.history.back();</script>");

        const buku = await query("SELECT stok FROM buku WHERE id = ?", [bukuId]);
        if (buku.length > 0 && buku[0].stok > 0) {
            await query("UPDATE buku SET stok = stok - 1 WHERE id = ?", [bukuId]);
            await query("INSERT INTO peminjaman (user_id, buku_id, tgl_pinjam, status, denda) VALUES (?, ?, CURDATE(), 'dipinjam', 0)", [userId, bukuId]);
            res.send("<script>alert('Buku berhasil dipinjam!'); window.location.href=document.referrer;</script>");
        } else {
            res.send("<script>alert('Stok habis!'); window.history.back();</script>");
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/kembali/:id', isLoggedIn, async (req, res) => {
    try {
        const pinjamId = req.params.id;
        const data = await query("SELECT * FROM peminjaman WHERE id = ?", [pinjamId]);
        if (data.length > 0) {
            const tglPinjam = new Date(data[0].tgl_pinjam);
            const selisih = Math.ceil((new Date() - tglPinjam) / (1000 * 60 * 60 * 24));
            let denda = (selisih > 7) ? (selisih - 7) * 1000 : 0;
            
            await query("UPDATE peminjaman SET status = 'dikembalikan', tgl_kembali = CURDATE(), denda = ? WHERE id = ?", [denda, pinjamId]);
            await query("UPDATE buku SET stok = stok + 1 WHERE id = ?", [data[0].buku_id]);
            res.send(`<script>alert('Berhasil Kembali! Denda: Rp ${denda}'); window.location.href=document.referrer;</script>`);
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- 7. ADMIN PANEL ---

app.get('/admin', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const sql = `
            SELECT * FROM buku ORDER BY id DESC;
            SELECT p.id, p.tgl_pinjam, u.nama as nama_peminjam, b.judul 
            FROM peminjaman p JOIN users u ON p.user_id = u.id JOIN buku b ON p.buku_id = b.id 
            WHERE p.status = 'dipinjam';
        `;
        const results = await query(sql);
        res.render('admin', { buku: results[0], laporan: results[1] });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/tambah', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const { judul, penulis, stok } = req.body;
        // tgl_input akan otomatis terisi oleh database (jika sudah di ALTER tadi)
        await query("INSERT INTO buku (judul, penulis, stok) VALUES (?, ?, ?)", [judul, penulis, stok]);
        res.redirect('/admin');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/admin/hapus/:id', isLoggedIn, isAdmin, async (req, res) => {
    try {
        await query("DELETE FROM buku WHERE id = ?", [req.params.id]);
        res.redirect('/admin');
    } catch (err) { res.status(500).send(err.message); }
});

// Update Stok Buku
app.post('/admin/edit/:id', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const { stok } = req.body;
        const { id } = req.params;
        await query("UPDATE buku SET stok = ? WHERE id = ?", [stok, id]);
        res.redirect('/admin');
    } catch (err) { 
        res.status(500).send("Gagal update stok: " + err.message); 
    }
});

// Penyesuaian Route Tambah (Agar konsisten dengan action form di admin.ejs)
app.post('/admin/tambah', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const { judul, penulis, stok } = req.body;
        await query("INSERT INTO buku (judul, penulis, stok, tgl_input) VALUES (?, ?, ?, NOW())", [judul, penulis, stok]);
        res.redirect('/admin');
    } catch (err) { 
        res.status(500).send("Gagal menambah buku: " + err.message); 
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));