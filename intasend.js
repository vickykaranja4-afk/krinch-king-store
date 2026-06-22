// Wraps calls to the IntaSend API for M-Pesa STK push payments.
// Docs: https://developers.intasend.com/docs/mpesa-stk-push
const fetch = require('node-fetch');

const INTASEND_TEST_MODE = process.env.INTASEND_TEST_MODE === 'true';
const BASE_URL = INTASEND_TEST_MODE
  ? 'https://sandbox.intasend.com/api/v1'
  : 'https://payment.intasend.com/api/v1';

const SECRET_KEY = process.env.INTASEND_SECRET_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/**
 * Normalizes a Kenyan phone number to the 2547XXXXXXXX format IntaSend expects.
 */
function normalizePhone(raw) {
  let phone = raw.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (phone.startsWith('+254')) phone = phone.slice(1);
  else if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  else if (phone.startsWith('254')) {
    // already correct
  } else if (phone.startsWith('7') || phone.startsWith('1')) {
    phone = '254' + phone;
  }
  return phone;
}

/**
 * Initiates an M-Pesa STK push for a given order.
 * Returns the IntaSend invoice/checkout details.
 */
async function initiateSTKPush({ phoneNumber, amount, orderId, apiRef }) {
  if (!SECRET_KEY || SECRET_KEY.includes('xxxx')) {
    throw new Error(
      'IntaSend secret key is not configured yet. Add your real key to .env as INTASEND_SECRET_KEY.'
    );
  }

  const normalizedPhone = normalizePhone(phoneNumber);

  const response = await fetch(`${BASE_URL}/payment/mpesa-stk-push/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET_KEY}`,
    },
    body: JSON.stringify({
      amount,
      phone_number: normalizedPhone,
      api_ref: apiRef || orderId,
      host: PUBLIC_BASE_URL,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.message || data?.detail || 'Payment request failed. Please try again.';
    throw new Error(message);
  }

  return data; // contains invoice.invoice_id, invoice.state, etc.
}

/**
 * Checks the current status of a payment by invoice id.
 */
async function checkPaymentStatus(invoiceId) {
  if (!SECRET_KEY || SECRET_KEY.includes('xxxx')) {
    throw new Error('IntaSend secret key is not configured yet.');
  }

  const response = await fetch(`${BASE_URL}/payment/status/${invoiceId}/`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || 'Could not check payment status.');
  }
  return data; // contains invoice.state: PENDING, COMPLETE, FAILED
}

module.exports = { initiateSTKPush, checkPaymentStatus, normalizePhone, createCardCheckout };

/**
 * Creates an IntaSend hosted checkout session for card payments.
 * Returns a URL to redirect the customer to for entering card details securely on IntaSend's page.
 */
async function createCardCheckout({ amount, orderId, email, redirectUrl }) {
  if (!SECRET_KEY || SECRET_KEY.includes('xxxx')) {
    throw new Error(
      'IntaSend secret key is not configured yet. Add your real key to .env as INTASEND_SECRET_KEY.'
    );
  }

  const response = await fetch(`${BASE_URL}/checkout/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET_KEY}`,
    },
    body: JSON.stringify({
      amount,
      currency: 'KES',
      email: email || 'customer@example.com',
      api_ref: orderId,
      redirect_url: redirectUrl,
      method: 'CARD-PAYMENT',
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.message || data?.detail || 'Could not start card checkout. Please try again.';
    throw new Error(message);
  }

  return data; // contains url (hosted checkout link) and id (checkout/invoice id)
}
