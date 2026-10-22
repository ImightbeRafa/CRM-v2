# Screencast script

Record in English captions over a Spanish UI (Meta accepts this; add a caption line for each step). 1080p, browser
zoom 100%, hide bookmarks and other tabs, no real customer data on screen: use the test business from
[reviewer-instructions.md](reviewer-instructions.md) §1. Each video starts at the Betsy login. Keep each one under five
minutes. Captions in quotes.

## Video 1: Instagram connection and messaging

Permissions: instagram_basic, pages_show_list, pages_read_engagement, pages_manage_metadata, business_management,
instagram_manage_messages, pages_messaging, plus instagram_manage_events in the dialog.

1. Log in at www.betsycrm.com/auth/signin. *"A business user logs in to Betsy CRM."*
2. Left menu → Configuración → **Cuentas conectadas**. *"Here the business connects its own Instagram account."*
3. Press **+ Agregar otra Instagram** (or + Conectar Instagram). Facebook Login for Business opens. Pause on the
   permission list so every permission, including **instagram_manage_events**, is readable. *"Betsy asks for these
   permissions. pages_show_list lists the person's Pages; business_management finds the business portfolio they
   choose."*
4. Choose the test Page / Instagram account and continue. Back in Betsy, the Instagram row shows *Conectado*.
   *"pages_read_engagement reads the Page's linked Instagram account; instagram_basic shows its username and picture;
   pages_manage_metadata subscribes the Page to message webhooks."*
5. On a phone, send a Direct message to the test account: "Hola, ¿tienen talla M?" Show the phone briefly.
6. In Betsy open **Chats**. The message appears with the sender's name and photo. *"instagram_manage_messages: the
   message arrives in the Betsy inbox."*
7. Type "¡Hola! Sí, tenemos talla M." and press **Enviar**. Show it arriving on the phone. *"pages_messaging: the
   business replies from Betsy."*

## Video 2: WhatsApp connection and messaging

Permissions: business_management, whatsapp_business_management, whatsapp_business_messaging, plus
whatsapp_business_manage_events in the dialog.

1. Configuración › Cuentas conectadas → **Agregar línea**. Embedded Signup opens. Pause on the permission screen so
   **whatsapp_business_manage_events** is readable. *"The business connects its WhatsApp Business number with Embedded
   Signup."*
2. Choose the business portfolio, WABA and test number. Back in Betsy the row shows the number as *Conectado*.
   *"whatsapp_business_management reads the account and its phone numbers and subscribes the webhooks."*
3. From a phone, send "Hola" to the number. It appears in **Chats**. Reply and show it arriving.
   *"whatsapp_business_messaging: receive and reply."*
4. Optional: open a chat older than 24 hours and show **Elegir plantilla…** → *Plantillas aprobadas*.
   *"whatsapp_business_management also lists the approved templates."*

## Video 3: Ad sale → paid order → Purchase event (WhatsApp and Instagram)

Permissions: whatsapp_business_manage_events, instagram_manage_events.

1. Configuración › Cuentas conectadas, scroll to **Ventas por anuncios (Meta)**. Show the notice text and that it is
   *Activado*, and both lines (*WhatsApp …* and *Instagram …*) say **Listo**. Press **Verificar con Meta**.
   *"Off by default. The owner turns it on and accepts this notice. Betsy checks each line's permission and gets the
   business's own dataset (POST /{WABA_ID}/dataset, POST /{IG_USER_ID}/dataset)."*
2. Open **Modo de prueba (Events Manager)**, paste the TEST code from Events Manager and press **Guardar**.
   *"Test mode, so the events show in Events Manager."*
3. **WhatsApp.** In Chats, open the WhatsApp conversation that started from the Click-to-WhatsApp ad. Show the right panel
   card **Llegó por un anuncio** with the ad. *"Meta's referral includes the ad click id (ctwa_clid)."*
4. Press **Crear pedido**. Add the product, choose **Retiro (RA)**, under **Estado de pago** choose **Pagado**, save.
   *"The order is paid."*
5. Switch to Events Manager → the dataset → **Test events**. Wait (the sender runs every 5 minutes; cut the wait in the
   edit). Show the Purchase event with channel WhatsApp, value and currency. *"Betsy sent one Purchase event: WABA id,
   ctwa_clid, value and currency only."*
6. **Instagram.** In Chats, open the Instagram conversation that started from the Instagram ad, show **Llegó por un
   anuncio**, create the order the same way with **Pagado**.
7. In Events Manager show the Instagram Purchase event. *"For Instagram Betsy sends the Instagram account id and the
   Instagram-scoped id (IGSID) from the webhook, value and currency. Used for measurement and reporting."*
8. Back in Betsy, show **Ventas enviadas (30 días)** went up by two.

## Video 4 (short): deletion

1. Show https://www.betsycrm.com/privacy, scroll to sections 5 (ad measurement) and 8 (disconnect vs deletion).
2. Show https://www.betsycrm.com/data-deletion.
3. Optional: in Facebook settings → Business integrations → remove Betsy CRM with "delete" ticked on the test user, then
   open the status link Meta shows. *"Betsy deletes the conversations received through that user's lines and shows the
   status."* Record this one last: it deletes the test chats.
