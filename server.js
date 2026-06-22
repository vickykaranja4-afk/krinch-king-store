require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const db = require('./db/database');
const { initiateSTKPush, checkPaymentStatus, createCardCheckout } = require('./intasend');
const { requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directories exist (Git doesn't track empty folders,
// so these must be created at runtime if missing)
const uploadDirs = [
  path.join(__dirname, 'public/uploads/mixes'),
  path.join(__dirname, 'public/uploads/covers'),
];
uploadDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created missing upload directory: ${dir}`);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 },
  })
);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const SITE = {
  name: process.env.SITE_NAME || 'DJ Krinch King — Mixes',
  djName: process.env.DJ_NAME || 'DJ Krinch King',
  currency: process.env.CURRENCY || 'KES',
};

// ---------- File upload config (admin mix uploads) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'cover') cb(null, path.join(__dirname, 'public/uploads/covers'));
    else cb(null, path.join(__dirname, 'public/uploads/mixes'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } }); // 300MB max

// ================= PUBLIC STOREFRONT =================

app.get('/', (req, res) => {
  const mixes = db
    .prepare('SELECT * FROM mixes WHERE is_active = 1 ORDER BY created_at DESC')
    .all();
  const worship = mixes.filter((m) => m.category === 'Worship');
  const praise = mixes.filter((m) => m.category === 'Praise');
  res.render('storefront', { site: SITE, worship, praise });
});

app.get('/mix/:id', (req, res) => {
  const mix = db.prepare('SELECT * FROM mixes WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!mix) return res.status(404).render('404', { site: SITE });
  res.render('mix-detail', { site: SITE, mix });
});

// ================= CHECKOUT / PAYMENT =================

// Step 1: customer submits phone number -> trigger STK push
app.post('/api/checkout', async (req, res) => {
  try {
    const { mixId, phoneNumber, amount } = req.body;
    if (!mixId || !phoneNumber || !amount) {
      return res.status(400).json({ error: 'Mix, phone number, and tip amount are required.' });
    }

    const mix = db.prepare('SELECT * FROM mixes WHERE id = ? AND is_active = 1').get(mixId);
    if (!mix) return res.status(404).json({ error: 'Mix not found.' });

    const tipAmount = parseInt(amount, 10);
    if (isNaN(tipAmount) || tipAmount < mix.price) {
      return res.status(400).json({ error: `Minimum tip is ${mix.price}.` });
    }

    const orderId = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, mix_id, phone_number, amount, status) VALUES (?, ?, ?, ?, 'pending')`
    ).run(orderId, mixId, phoneNumber, tipAmount);

    const result = await initiateSTKPush({
      phoneNumber,
      amount: tipAmount,
      orderId,
      apiRef: orderId,
    });

    const invoiceId = result?.invoice?.invoice_id;
    db.prepare('UPDATE orders SET intasend_invoice_id = ? WHERE id = ?').run(invoiceId, orderId);

    res.json({ orderId, invoiceId, message: 'Check your phone and enter your M-Pesa PIN.' });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message || 'Something went wrong starting your payment.' });
  }
});

// Card checkout — creates an IntaSend hosted checkout session for card payments
app.post('/api/checkout/card', async (req, res) => {
  try {
    const { mixId, amount } = req.body;
    if (!mixId || !amount) {
      return res.status(400).json({ error: 'Mix and tip amount are required.' });
    }

    const mix = db.prepare('SELECT * FROM mixes WHERE id = ? AND is_active = 1').get(mixId);
    if (!mix) return res.status(404).json({ error: 'Mix not found.' });

    const tipAmount = parseInt(amount, 10);
    if (isNaN(tipAmount) || tipAmount < mix.price) {
      return res.status(400).json({ error: `Minimum tip is ${mix.price}.` });
    }

    const orderId = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, mix_id, phone_number, amount, status) VALUES (?, ?, ?, ?, 'pending')`
    ).run(orderId, mixId, 'card-payment', tipAmount);

    const redirectUrl = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/mix/${mixId}?order=${orderId}`;

    const result = await createCardCheckout({
      amount: tipAmount,
      orderId,
      redirectUrl,
    });

    db.prepare('UPDATE orders SET intasend_invoice_id = ? WHERE id = ?').run(result.id, orderId);

    res.json({ orderId, checkoutUrl: result.url });
  } catch (err) {
    console.error('Card checkout error:', err.message);
    res.status(500).json({ error: err.message || 'Something went wrong starting your card payment.' });
  }
});


// Step 2: frontend polls this to check if payment has completed
app.get('/api/checkout/status/:orderId', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.status === 'paid') {
      return res.json({ status: 'paid', downloadUrl: `/download/${order.download_token}` });
    }
    if (order.status === 'failed') {
      return res.json({ status: 'failed' });
    }

    // Still pending — ask IntaSend for the latest state
    if (order.intasend_invoice_id) {
      const result = await checkPaymentStatus(order.intasend_invoice_id);
      const state = result?.invoice?.state;

      if (state === 'COMPLETE') {
        const token = uuidv4();
        db.prepare(
          `UPDATE orders SET status = 'paid', download_token = ?, paid_at = datetime('now') WHERE id = ?`
        ).run(token, order.id);
        return res.json({ status: 'paid', downloadUrl: `/download/${token}` });
      }
      if (state === 'FAILED') {
        db.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`).run(order.id);
        return res.json({ status: 'failed' });
      }
    }

    res.json({ status: 'pending' });
  } catch (err) {
    console.error('Status check error:', err.message);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

// Step 3 (alternative): IntaSend calls this webhook directly when payment completes
app.post('/api/webhook/intasend', (req, res) => {
  try {
    const { invoice_id, state, api_ref } = req.body;
    if (state === 'COMPLETE') {
      const order = db.prepare('SELECT * FROM orders WHERE intasend_invoice_id = ? OR id = ?').get(invoice_id, api_ref);
      if (order && order.status !== 'paid') {
        const token = uuidv4();
        db.prepare(
          `UPDATE orders SET status = 'paid', download_token = ?, paid_at = datetime('now') WHERE id = ?`
        ).run(token, order.id);
      }
    }
    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(200).send('ok'); // always 200 so IntaSend doesn't retry-storm us
  }
});

// Step 4: secure one-time download
app.get('/download/:token', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE download_token = ?').get(req.params.token);
  if (!order || order.status !== 'paid') {
    return res.status(403).render('404', { site: SITE, message: 'This download link is invalid or has expired.' });
  }

  const mix = db.prepare('SELECT * FROM mixes WHERE id = ?').get(order.mix_id);
  const filePath = path.join(__dirname, 'public/uploads/mixes', mix.audio_filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).render('404', { site: SITE, message: 'File not found. Please contact support.' });
  }

  // Mark as used (informational; we still allow re-download from same link in case of network drop,
  // but you can make this stricter by blocking after first use)
  res.download(filePath, `${mix.title}.mp3`);
});

// ================= ADMIN =================

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { site: SITE, error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { site: SITE, error: 'Incorrect username or password.' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', requireAdmin, (req, res) => {
  const mixes = db.prepare('SELECT * FROM mixes ORDER BY created_at DESC').all();
  const orders = db
    .prepare(
      `SELECT orders.*, mixes.title as mix_title FROM orders
       LEFT JOIN mixes ON mixes.id = orders.mix_id
       ORDER BY orders.created_at DESC LIMIT 50`
    )
    .all();
  const totalSales = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM orders WHERE status = 'paid'`).get();
  res.render('admin-dashboard', { site: SITE, mixes, orders, totalSales: totalSales.total });
});

app.post(
  '/admin/mixes',
  requireAdmin,
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  (req, res) => {
    const { title, description, price, duration_label, category } = req.body;
    const audioFile = req.files?.audio?.[0];
    const coverFile = req.files?.cover?.[0];

    if (!title || !price || !audioFile) {
      return res.redirect('/admin?error=missing_fields');
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO mixes (id, title, description, price, category, cover_filename, audio_filename, duration_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      title,
      description || '',
      parseInt(price, 10),
      category === 'Praise' ? 'Praise' : 'Worship',
      coverFile ? coverFile.filename : null,
      audioFile.filename,
      duration_label || ''
    );

    res.redirect('/admin');
  }
);

app.post('/admin/mixes/:id/toggle', requireAdmin, (req, res) => {
  const mix = db.prepare('SELECT * FROM mixes WHERE id = ?').get(req.params.id);
  if (mix) {
    db.prepare('UPDATE mixes SET is_active = ? WHERE id = ?').run(mix.is_active ? 0 : 1, mix.id);
  }
  res.redirect('/admin');
});

app.post('/admin/mixes/:id/delete', requireAdmin, (req, res) => {
  const mix = db.prepare('SELECT * FROM mixes WHERE id = ?').get(req.params.id);
  if (mix) {
    const audioPath = path.join(__dirname, 'public/uploads/mixes', mix.audio_filename);
    const coverPath = mix.cover_filename
      ? path.join(__dirname, 'public/uploads/covers', mix.cover_filename)
      : null;
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    if (coverPath && fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    db.prepare('DELETE FROM mixes WHERE id = ?').run(mix.id);
  }
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`${SITE.name} running at http://localhost:${PORT}`);
});
