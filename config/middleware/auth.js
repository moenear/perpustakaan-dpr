module.exports = {
  isLoggedIn: (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
  },
  isAdmin: (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    res.status(403).send('Akses Ditolak: Anda bukan Admin!');
  }
};