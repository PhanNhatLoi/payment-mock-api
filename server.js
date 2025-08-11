import express from "express";
import "dotenv/config";
import {
  ApiError,
  Client,
  Environment,
  OrdersController,
} from "@paypal/paypal-server-sdk";
import bodyParser from "body-parser";
import cors from "cors";
import stripe from "stripe";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  STRIPE_SECRET_KEY,
  PORT = 4242,
} = process.env;

// Initialize Stripe
const stripeClient = stripe(STRIPE_SECRET_KEY);

// Initialize PayPal
const paypalClient = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: PAYPAL_CLIENT_ID,
    oAuthClientSecret: PAYPAL_CLIENT_SECRET,
  },
  environment: Environment.Sandbox,
  timeout: 3000,
});

const ordersController = new OrdersController(paypalClient);

// Existing Stripe payment sheet endpoint
app.get("/payment-sheet", async (req, res) => {
  try {
    const email = "leo@gmail.com".toString();
    const customerId = await getOrCreateStripeCustomerByEmail(email);

    const ephemeralKey = await stripeClient.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2022-11-15" }
    );

    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      // automatic_payment_methods: { enabled: false },
      // payment_method_types: ["card"],
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Create an order to start the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_create
 */
const createOrder = async () => {
  const collect = {
    body: {
      intent: "CAPTURE",
      purchaseUnits: [
        {
          amount: {
            currencyCode: "USD",
            value: "100",
          },
        },
      ],
      paymentSource: {
        paypal: {
          emailAddress: "leo-personal@gmail.com",
          experienceContext: {
            returnUrl: `${process.env.BASE_URL}/paypal-success`,
            cancelUrl: `${process.env.BASE_URL}/paypal-cancel`,
          },
        },
      },
      applicationContext: {
        userAction: "PAY_NOW",
      },
    },
    prefer: "return=minimal",
  };

  try {
    const { body, ...httpResponse } = await ordersController.createOrder(
      collect
    );
    // Get more response info...
    // const { statusCode, headers } = httpResponse;
    return {
      jsonResponse: JSON.parse(body),
      httpStatusCode: httpResponse.statusCode,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // const { statusCode, headers } = error;
      throw new Error(error.message);
    }
  }
};

// createOrder route
app.get("/paypal-order", async (req, res) => {
  try {
    const { jsonResponse, httpStatusCode } = await createOrder();
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to create order." });
  }
});

/**
 * Capture payment for the created order to complete the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_capture
 */
const captureOrder = async (orderID) => {
  const collect = {
    id: orderID,
    prefer: "return=minimal",
  };

  try {
    const { body, ...httpResponse } = await ordersController.captureOrder(
      collect
    );
    return {
      jsonResponse: JSON.parse(body),
      httpStatusCode: httpResponse.statusCode,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(error.message);
    }
  }
};

app.get("/paypal-success", async (req, res) => {
  const { token, PayerID } = req.query;

  // Deep link app bạn muốn redirect tới, có thể build tùy ý với param
  const appDeepLink = `aitravel://app/booking_submitted?bookingId=${token}`;

  const successHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <title>Payment Success</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 2rem; }
      </style>
    </head>
    <body>
      <h2>Thanh toán thành công!</h2>
      <p>Order ID: ${token}</p>
      <p>Payer ID: ${PayerID}</p>
      <p>Bạn sẽ được chuyển đến app trong giây lát...</p>

      <script>
        // Chuyển hướng sang deep link mở app
        setTimeout(() => {
          window.location.href = '${appDeepLink}';
        }, 2000);

        // Thêm fallback nếu browser không mở được app, chuyển về trang web hoặc thông báo
        setTimeout(() => {
          document.body.innerHTML += '<p>Nếu app không tự mở, vui lòng <a href="${appDeepLink}">bấm vào đây</a>.</p>';
        }, 2500);
      </script>
    </body>
    </html>
  `;

  res.send(successHtml);
});

// Payment cancel endpoint for React Native
app.get("/paypal-cancel", (req, res) => {
  const { token } = req.query;

  console.log("Payment cancelled - Token:", token);

  // Trả về HTML với sự kiện cho React Native
  const cancelHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <title>Payment Cancelled</title>
    </head>
    <body>
      <h2>Payment Cancelled</h2>
      <p>Order ID: ${token}</p>
      
      <script>
        // Gửi sự kiện cancel về React Native
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          status: 'cancelled',
          orderId: '${token}',
          timestamp: '${new Date().toISOString()}',
          message: 'Payment was cancelled by user'
        }));
        
        // Tự động đóng WebView sau 2 giây
        setTimeout(() => {
          window.ReactNativeWebView?.postMessage(JSON.stringify({
            status: 'close',
            message: 'Closing WebView'
          }));
        }, 2000);
      </script>
    </body>
    </html>
  `;

  res.send(cancelHtml);
});

app.listen(PORT, () => {
  console.log(`Node server listening at http://localhost:${PORT}/`);
});
