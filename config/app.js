const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();

// Konfigurasi EJS & Public Folder
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Session untuk Login
app.use(session({
  secret: 'perpustakaan-dpr-secret',
  resave: false,
  saveUninitialized: true
}));

// Import Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

// Gunakan Routes
app.use('/', authRoutes);
app.use('/admin', adminRoutes); // Hanya bisa diakses jika role admin
app.use('/user', userRoutes);   // Hanya bisa diakses jika role anggota

const PORT = 3000;
app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));

app.get('/', (req, res) => {
    res.render('index');
});