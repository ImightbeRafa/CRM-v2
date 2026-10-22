# Permission texts for App Review (app 1038331905909624)

Paste each block into the "How will your app use this permission?" box in App Review. They are in English, short and
specific, Meta's style. Each says what the business does in Betsy, which screen shows it, and what we do not do. The
screencast steps for each permission are in [screencast-script.md](screencast-script.md).

Betsy CRM (www.betsycrm.com) is a sales inbox and order system for small businesses in Costa Rica. A business connects
its own Instagram professional account and WhatsApp Business number, answers customers in one inbox, and turns chats into
orders.

---

## New in this submission

### whatsapp_business_manage_events

Betsy uses this permission to send Purchase events to the business's own dataset through the Conversions API for
Business Messaging, and only after the business owner turns on "Ventas por anuncios (Meta)" in Configuración › Cuentas
sociales and accepts a notice. When a customer starts a WhatsApp chat from a Click-to-WhatsApp ad, we store the ctwa_clid
from the messages webhook referral. If an order from that chat is created within 7 days of the click and marked paid, Betsy calls
POST /{WABA_ID}/dataset (once, to get the business's dataset) and POST /{DATASET_ID}/events with action_source
business_messaging, messaging_channel whatsapp, user_data { whatsapp_business_account_id, ctwa_clid } and custom_data
{ currency, value }. We send no names, phone numbers, emails or message content. Each order is sent once (an event id per
order). The business sees in Ads Manager which ads produced paid sales, and Meta can optimize the ads for purchases. The
owner can turn it off at any time.

### instagram_manage_events

Betsy uses this permission to report paid sales from Instagram Direct conversations that started from an Instagram ad, to
the business's own dataset (Conversions API for Business Messaging), only after the owner turns on "Ventas por anuncios
(Meta)" and accepts a notice that names the Instagram id. When a customer messages from an ad, the messages webhook gives
a referral with the ad id; Betsy stores it with the conversation. If an order from that chat is created within 7
days of that message and marked paid, Betsy calls POST /{IG_USER_ID}/dataset (once) and POST /{DATASET_ID}/events with action_source business_messaging,
messaging_channel instagram, user_data { instagram_business_account_id, ig_sid } and custom_data { currency, value }.
ig_sid is the Instagram-scoped id from the webhook; we send no name, username, phone, email or message content. One event
per order. The business uses it to measure which Instagram ads bring real sales. The owner can turn it off at any time.

---

## Already approved, re-reviewed

### instagram_basic

Betsy reads the connected Instagram professional account's id and username, so the business can
choose which account to connect, see it in Configuración › Cuentas conectadas and in the inbox header, and so we can match
incoming messages to the right account. We do not read or publish posts.

### instagram_manage_messages

Betsy receives the business's Instagram Direct messages through the webhook and shows them in the Betsy inbox (/chats),
where the business's team, or its AI agent if the business turned one on, replies within the 24-hour window. Replies are
sent with the Send API from the inbox composer. We read the customer's name, username and profile picture to show who is
writing. Messages are used only to answer that business's customers and turn chats into orders.

### pages_show_list

During Instagram connection Betsy lists the Facebook Pages the person manages (me/accounts) so they can choose the Page
linked to the Instagram professional account they want to connect. Nothing else is done with the list.

### pages_read_engagement

Betsy reads the selected Page's linked Instagram business account (instagram_business_account { id, username }) and the
Page name, which are needed to connect that Instagram account to the inbox. We do not read Page posts, comments or
insights.

### pages_manage_metadata

Betsy subscribes the selected Page to the messages webhook (POST /{PAGE_ID}/subscribed_apps) so new Instagram Direct
messages reach the Betsy inbox in real time, and checks it again when the business presses "Reparar webhook" on the line. We
change no other Page setting.

### pages_messaging

Betsy uses the Page access token to send the business's replies to Instagram Direct conversations from the Betsy inbox
(the Instagram Messaging API runs through the linked Page). Only replies written or approved by the business, or by its
own AI agent when it turned one on, are sent, within Meta's messaging window.

### business_management

During Facebook Login for Business and WhatsApp Embedded Signup, Betsy reads the business portfolio the person chose so it
can find the Page / Instagram account and the WhatsApp Business account (WABA) and phone number they granted. We do not
create, edit or delete business assets, people or ad accounts.

### whatsapp_business_management

After Embedded Signup, Betsy reads the WhatsApp Business account and its phone numbers (id, display number, verified
name), subscribes our app to the WABA's webhooks, and reads the approved message templates so the business can pick one
when the 24-hour window is closed. The connection status is shown in Configuración › Cuentas conectadas.

### whatsapp_business_messaging

Betsy receives the business's WhatsApp messages (text, images, audio, documents) through the webhook, shows them in the
Betsy inbox and sends the business's replies, and approved templates outside the 24-hour window, from the inbox composer.
Messages are used only to serve that business's customers and their orders.

---

Notes for Rafael (not for the form):

- IG_USER_ID equals instagram_business_account_id. It is the id the Page returns in `instagram_business_account`, stored
  as `SocialAccount.accountId`. Meta's sample payload uses it under that name.
- Purchase optimization is not offered for Instagram ads (measurement and reporting only). The text above says
  "measure", not "optimize".
- The events go only to the business's own dataset, created under the business's own WABA or IG account. Betsy owns no
  dataset and never sees other businesses' data.
