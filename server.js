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
  BASE_URL,
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
    const customer = await stripeClient.customers.create({
      email: "leo@gmail.com",
    });

    const ephemeralKey = await stripeClient.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2025-07-30.basil" }
    );

    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      // automatic_payment_methods: { enabled: false },
      // payment_method_types: ["card"],
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
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
            returnUrl: `${BASE_URL}/paypal-success`,
            cancelUrl: `${BASE_URL}/paypal-cancel`,
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

app.get("/nicepay-order", async (req, res) => {
  try {
    const response = await fetch(
      "https://dev.nicepay.co.id/nicepay/redirect/v2/registration",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeStamp: "20250211090266",
          iMid: "IONPAYTEST",
          payMethod: "00",
          currency: "IDR",
          amt: "10000",
          referenceNo: "ORD20250211090266",
          goodsNm: "Jhon Doe",
          billingNm: "Jhon Doe",
          billingPhone: "08123456789",
          billingEmail: "jhondoe@gmail.com",
          billingAddr: "Jalan Bukit Berbunga 22",
          billingCity: "Jakarta",
          billingState: "DKI Jakarta",
          billingPostCd: "12345",
          billingCountry: "Indonesia",
          deliveryNm: "jhondoe@gmail.com",
          deliveryPhone: "08123456789",
          deliveryAddr: "Jalan Bukit Berbunga 22",
          deliveryCity: "Jakarta",
          deliveryState: "DKI Jakarta",
          deliveryPostCd: "12345",
          deliveryCountry: "Indonesia",
          dbProcessUrl: "http://ptsv2.com/t/Merchant/post",
          callBackUrl: `${BASE_URL}/nicepay-success`,
          vat: "",
          fee: "",
          notaxAmt: "",
          description: "Test Transaction Nicepay",
          merchantToken:
            "d339576df6d69763073b626fc88b0bbe9e0f9023d376d37372e1af96dde7d059",
          reqDt: "",
          reqTm: "",
          reqDomain: "merchant.com",
          reqServerIP: "127.0.0.1",
          reqClientVer: "",
          userIP: "127.0.0.1",
          userSessionID: "697D6922C961070967D3BA1BA5699C2C",
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,like Gecko) Chrome/60.0.3112.101 Safari/537.36",
          userLanguage: "ko-KR,en-US;q=0.8,ko;q=0.6,en;q=0.4",
          cartData:
            '{"count":"1","item":[{"goods_id":"BB12345678","goods_detail":"BB12345678","goods_name":"Pasar Modern","goods_amt":"10000","goods_type":"Sembako","goods_url":"http://merchant.com/cellphones/iphone5s_64g","goods_quantity":"1","goods_sellers_id":"SEL123","goods_sellers_name":"Sellers 1"}]}',
          sellers:
            '[{"sellersId": "SEL123","sellersNm": "Sellers 1","sellersEmail":"sellers@test.com","sellersAddress": {"sellerNm": "Sellers","sellerLastNm": "1","sellerAddr": "jalan berbangsa 1","sellerCity":"Jakarta Barat","sellerPostCd": "12344","sellerPhone":"08123456789","sellerCountry": "ID"}}]',
          instmntType: "2",
          instmntMon: "1",
          recurrOpt: "1",
          bankCd: "",
          vacctValidDt: "",
          vacctValidTm: "",
          payValidDt: "",
          payValidTm: "",
          merFixAcctId: "",
          mitraCd: "",
          paymentExpDt: "",
          paymentExpTm: "",
          shopId: "",
        }),
      }
    );

    const data = await response.json();
    const nicePayUrl = data.paymentURL + "?tXid=" + data.tXid;
    res.json({ ...data, nicePayUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Payment request failed" });
  }
});

app.post("/nicepay-success", async (req, res) => {
  const { token, PayerID } = {
    token: "YI-4932",
    PayerID: "1234567890",
  };
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

app.listen(PORT, () => {
  console.log(`Node server listening at http://localhost:${PORT}/`);
});
