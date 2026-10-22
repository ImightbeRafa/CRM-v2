# Reviewer instructions

Two parts. §1 is for Rafael, to prepare the test login (do it on www.betsycrm.com, which uses the real database: use a
separate test business, never a customer's). §2 is the text to paste into App Review → "Reviewer instructions" (English).

## 1. Prepare (Rafael)

1. Open https://www.betsycrm.com/auth/signin → **¿No tienes cuenta? Regístrate** → *Crear cuenta*. Use a new mailbox you
   control (for example `meta-review@betsycrm.com`), the name "Meta Reviewer" and a password with 8+ characters,
   upper, lower and a number. Registering creates its own business automatically. Pass Turnstile yourself. Do not reuse
   your own password anywhere else.
2. Sign in once as that user and skip the setup wizard (**Omitir**).
3. In **Configuración › Cuentas conectadas** (`/config/social`):
   - **+ Conectar Instagram**: connect a test Instagram professional account linked to a test Facebook Page that you own.
     In the Facebook dialog tick all your Pages.
   - **Agregar línea**: run WhatsApp Embedded Signup with a test WhatsApp Business number.
   - Both rows must show *Conectado*.
4. In the card **Ventas por anuncios (Meta)**: tick the notice, switch to *Activado*, press **Verificar con Meta**. After
   approval both lines should say *Listo*. Before approval they say *Falta permiso*, which is expected and can be shown.
5. Create one product and set the business currency to colones (default) so an order can be made quickly.
6. Ad-chat for the demo: run a small Click-to-WhatsApp ad and an Instagram "Send message" ad (₡1 000 a day for one day is
   enough) aimed at yourself, tap each ad from a phone and send "Hola". The chat then shows **Llegó por un anuncio** in
   Betsy. Keep these two chats for the screencast.
7. Optional, to show events live: Events Manager → the dataset → **Test events**, copy the code (TEST…) and paste it in
   the card under **Modo de prueba (Events Manager)** → **Guardar**. It is valid for 24 hours.
8. Write the login (email + password) only into the App Review form's test credentials fields, nowhere else.

## 2. Text for the App Review form

> Betsy CRM is a sales inbox for small businesses. The business connects its own Instagram professional account and
> WhatsApp Business number, answers customers in one inbox, and turns chats into orders.
>
> **Log in:** https://www.betsycrm.com/auth/signin with the test credentials provided. The account already has a test
> Instagram account and WhatsApp number connected.
>
> **Instagram (instagram_basic, instagram_manage_messages, pages_show_list, pages_read_engagement,
> pages_manage_metadata, pages_messaging, business_management):**
> 1. Open Configuración › Cuentas conectadas (left menu → Configuración → Cuentas conectadas). The Instagram row shows the
>    connected account. "+ Agregar otra Instagram" opens Facebook Login for Business with the permission dialog.
> 2. Send a Direct message to the test Instagram account from any Instagram user. Open Chats (left menu). The message
>    arrives in a few seconds, with the sender's name and photo.
> 3. Type a reply in the box at the bottom ("Escribí un mensaje…") and press Enviar. It arrives in Instagram.
>
> **WhatsApp (whatsapp_business_management, whatsapp_business_messaging):**
> 1. In Configuración › Cuentas conectadas, the WhatsApp row shows the connected number. "Agregar línea" opens Embedded
>    Signup.
> 2. Send a WhatsApp message to the test number. It arrives in Chats. Reply with the composer. When the 24-hour window is
>    closed, "Elegir plantilla…" lists the approved templates.
>
> **Ad sales measurement (whatsapp_business_manage_events, instagram_manage_events):**
> 1. In Configuración › Cuentas conectadas, the card "Ventas por anuncios (Meta)" is on, and each line shows its state
>    ("Listo" when the permission is granted).
> 2. In Chats, open the conversation marked "Llegó por un anuncio" (right panel shows the ad).
> 3. Press "Crear pedido", add the product, choose "Retiro (RA)" and under "Estado de pago" choose "Pagado", then save.
> 4. Within 5 minutes Betsy sends one Purchase event to the business's own dataset (Conversions API for Business
>    Messaging): for WhatsApp with the ctwa_clid, for Instagram with the Instagram-scoped id. No name, phone or message is
>    sent. With the test code saved, the event appears in Events Manager → Test events (test sends are not counted). Without a test code, the card's counter "Ventas enviadas (30 días)" goes up instead.
>
> **Data deletion:** remove the app in Facebook settings and request deletion; the callback returns a status link
> (https://www.betsycrm.com/data-deletion?code=…). Privacy policy: https://www.betsycrm.com/privacy.
>
> If an agent is turned on for a chat, the composer says "Tomá control o pausá el agente para escribir": press the button
> above the composer to take control first. The interface is in Spanish.
