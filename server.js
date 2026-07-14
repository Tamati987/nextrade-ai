const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Stripe setup ──
let stripe;
try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch(e) {}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'nextrade-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory DB (remplacer par MongoDB/PostgreSQL en prod) ──
const users = new Map();
const subscriptions = new Map();

// ── MIDDLEWARE AUTH ──
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.session.token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret-2026');
    req.user = decoded;
    next();
  } catch { res.status(401).json({ error: 'Token invalide' }); }
}

function requireSubscription(req, res, next) {
  const sub = subscriptions.get(req.user.email);
  if (!sub || sub.status !== 'active') return res.status(403).json({ error: 'Abonnement requis' });
  next();
}

// ── AUTH ROUTES ──
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (users.has(email)) return res.status(409).json({ error: 'Email déjà utilisé' });
  const hash = await bcrypt.hash(password, 10);
  users.set(email, { email, name: name || email, password: hash, createdAt: new Date() });
  const token = jwt.sign({ email, name }, process.env.JWT_SECRET || 'jwt-secret-2026', { expiresIn: '7d' });
  res.json({ token, user: { email, name } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.get(email);
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const token = jwt.sign({ email, name: user.name }, process.env.JWT_SECRET || 'jwt-secret-2026', { expiresIn: '7d' });
  const sub = subscriptions.get(email);
  res.json({ token, user: { email, name: user.name }, subscription: sub || null });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const sub = subscriptions.get(req.user.email);
  res.json({ user: req.user, subscription: sub || null });
});

// ── STRIPE ROUTES ──
app.post('/api/stripe/create-checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: req.user.email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'NexTrade AI — Abonnement Pro',
            description: '5 bots de trading IA illimités · Claude intégré · XAU/USD inclus',
            images: [],
          },
          unit_amount: 1900, // 19€
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      success_url: `${process.env.APP_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/pricing`,
      metadata: { userEmail: req.user.email },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STRIPE WEBHOOK ──
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const email = event.data.object.customer_email || event.data.object.metadata?.userEmail;
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    subscriptions.set(email, { status: 'active', plan: 'pro', price: 19, activatedAt: new Date(), renewsAt: new Date(Date.now() + 30*24*60*60*1000) });
    console.log(`✅ Abonnement activé: ${email}`);
  }
  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    subscriptions.set(email, { status: 'inactive', plan: null });
    console.log(`❌ Abonnement annulé: ${email}`);
  }
  res.json({ received: true });
});

app.get('/api/stripe/verify-session', requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    if (session.payment_status === 'paid') {
      const email = session.customer_email || req.user.email;
      subscriptions.set(email, { status: 'active', plan: 'pro', price: 19, activatedAt: new Date(), renewsAt: new Date(Date.now() + 30*24*60*60*1000) });
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PAYPAL ROUTES ──
app.post('/api/paypal/create-order', requireAuth, async (req, res) => {
  try {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    const { access_token } = await tokenRes.json();
    const orderRes = await fetch('https://api-m.paypal.com/v1/billing/subscriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: process.env.PAYPAL_PLAN_ID,
        subscriber: { email_address: req.user.email },
        application_context: {
          return_url: `${process.env.APP_URL || 'http://localhost:3000'}/success?provider=paypal`,
          cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/pricing`,
          brand_name: 'NexTrade AI',
          user_action: 'SUBSCRIBE_NOW'
        }
      })
    });
    const order = await orderRes.json();
    const approveLink = order.links?.find(l => l.rel === 'approve')?.href;
    res.json({ approveUrl: approveLink, subscriptionId: order.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/paypal/activate', requireAuth, async (req, res) => {
  const { subscriptionId } = req.body;
  subscriptions.set(req.user.email, { status: 'active', plan: 'pro', price: 19, provider: 'paypal', subscriptionId, activatedAt: new Date(), renewsAt: new Date(Date.now() + 30*24*60*60*1000) });
  res.json({ success: true });
});

// ── CLAUDE API PROXY ──
app.post('/api/chat', requireAuth, requireSubscription, async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Messages requis' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 1000,
        system: `Tu es un expert en trading algorithmique sur NexTrade AI. Tu analyses crypto (BTC, ETH), Forex (EUR/USD, GBP/USD) et Or (XAU/USD). L'utilisateur est ${req.user.name || req.user.email}. Réponds en français, de façon concise et experte.`,
        messages
      })
    });
    const data = await response.json();
    res.json({ reply: data.content?.[0]?.text || 'Pas de réponse.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── MARKET DATA ──
app.get('/api/market', (req, res) => {
  const n = (v, p, d=2) => +(v*(1+(Math.random()-.5)*p)).toFixed(d);
  res.json({
    BTC: { price: n(67420,.005,0), change: +(Math.random()*4-1.5).toFixed(2) },
    ETH: { price: n(3521,.005,0), change: +(Math.random()*3-1).toFixed(2) },
    EURUSD: { price: n(1.0842,.001,4), change: +(Math.random()*.6-.2).toFixed(2) },
    XAUUSD: { price: n(2374.50,.003,2), change: +(Math.random()*1.5-.5).toFixed(2) },
  });
});

// ── HEALTH ──
app.get('/health', (req, res) => res.json({ status: 'ok', users: users.size, subscriptions: subscriptions.size }));

app.listen(PORT, () => {
  console.log(`\n🚀 NexTrade AI → http://localhost:${PORT}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌ manquant'}`);
  console.log(`🅿️  PayPal: ${process.env.PAYPAL_CLIENT_ID ? '✅' : '❌ manquant'}`);
  console.log(`🧠 Claude: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌ manquant'}`);
});
