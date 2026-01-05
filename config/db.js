const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '', // Default XAMPP kosong
  database: 'perpustakaan_dpr'
});

connection.connect((err) => {
  if (err) throw err;
  console.log('Database MySQL Terhubung!');
});

module.exports = connection;