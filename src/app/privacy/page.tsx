export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
        
        <p className="text-sm text-gray-500 mb-6">
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>

        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
            <p>
              Welcome to Betsy CRM (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting your personal 
              information and your right to privacy. This Privacy Policy explains how we collect, use, 
              and share information when you use our CRM platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">2.1 Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Account Information:</strong> Name, email address, username, and password when you create an account</li>
              <li><strong>Business Data:</strong> Customer information, orders, inventory, invoices, and other business data you enter into the CRM</li>
              <li><strong>Profile Information:</strong> Any additional information you choose to add to your profile</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">2.2 Information from Google Sign-In</h3>
            <p className="mb-2">When you sign in with Google, we collect:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Email address:</strong> Used to create and identify your account</li>
              <li><strong>Profile information:</strong> Name and profile picture from your Google account</li>
              <li><strong>Google account ID:</strong> To link your Google account with our service</li>
            </ul>
            <p className="mt-2 text-sm italic">
              Note: We only access basic profile information. We do NOT access your Gmail, Drive, Calendar, or any other Google services.
            </p>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">2.3 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Usage Data:</strong> How you interact with our platform (features used, time spent, etc.)</li>
              <li><strong>Device Information:</strong> Browser type, operating system, IP address</li>
              <li><strong>Cookies:</strong> For authentication and session management</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
            <p className="mb-2">We use your information to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide and maintain the CRM service</li>
              <li>Create and manage your account</li>
              <li>Process and store your business data (orders, customers, inventory)</li>
              <li>Send you service-related notifications</li>
              <li>Improve our platform and user experience</li>
              <li>Ensure security and prevent fraud</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. How We Share Your Information</h2>
            <p className="mb-2">We do NOT sell your personal information. We may share your information only in these situations:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>With your team:</strong> Data you enter is shared with other users in your organization/tenant</li>
              <li><strong>Service providers:</strong> Third-party services that help us operate (hosting, database, email)</li>
              <li><strong>Legal requirements:</strong> When required by law or to protect rights and safety</li>
              <li><strong>Business transfers:</strong> In case of merger, acquisition, or sale of assets</li>
            </ul>
          </section>

          <section id="security">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Security</h2>
            <p>
              We implement appropriate security measures to protect your information:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Passwords are encrypted using industry-standard bcrypt hashing</li>
              <li>Data transmission is secured with HTTPS/SSL encryption</li>
              <li>Database access is restricted and monitored</li>
              <li>Regular security audits and updates</li>
              <li>Multi-tenant architecture ensures data isolation between organizations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Your Rights and Choices</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Update or correct your information</li>
              <li><strong>Deletion:</strong> Request deletion of your account and data</li>
              <li><strong>Export:</strong> Download your data in a portable format</li>
              <li><strong>Opt-out:</strong> Unsubscribe from marketing emails (service emails may still be sent)</li>
              <li><strong>Revoke Google access:</strong> Disconnect your Google account at any time through your Google account settings</li>
            </ul>
            <p className="mt-3">
              To exercise these rights, contact us at: <a href="mailto:support@betsycrm.com" className="text-blue-600 hover:underline">support@betsycrm.com</a>
            </p>
          </section>

          <section id="instagram-facebook">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Instagram & Facebook Data Usage</h2>
            <p className="mb-2">
              When you connect your Instagram Business or WhatsApp Business account to Betsy CRM, we access and process the following data:
            </p>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">7.1 Data We Access</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Instagram Business Account:</strong> Account ID, username, profile information</li>
              <li><strong>Instagram Messages:</strong> Direct messages sent to/from your business account for CRM management</li>
              <li><strong>Facebook Page:</strong> Page ID and page access tokens (required for Instagram API access)</li>
              <li><strong>WhatsApp Business:</strong> Phone number ID, business account information, and messages</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">7.2 How We Use This Data</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Display and manage customer conversations within Betsy CRM</li>
              <li>Send responses to customer inquiries on your behalf</li>
              <li>Link conversations to customer profiles and orders</li>
              <li>Generate analytics about your customer communications</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">7.3 Data Retention & Deletion</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Messages are stored for as long as you maintain the connection</li>
              <li>You can disconnect your account at any time from Settings → Social Accounts</li>
              <li>Upon disconnection, we delete access tokens and message history within 24 hours</li>
              <li>You can request full data deletion by emailing <a href="mailto:support@betsycrm.com" className="text-blue-600 hover:underline">support@betsycrm.com</a></li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">7.4 Data Sharing</h3>
            <p>
              We do NOT share, sell, or transfer your Instagram/Facebook/WhatsApp data to third parties.
              Your data is only accessible to you and your authorized team members within Betsy CRM.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Google OAuth Disclosure</h2>
            <p className="mb-2">
              When you sign in with Google, we use Google&apos;s OAuth 2.0 service. Our use of Google user data is limited to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Authenticating your identity</li>
              <li>Retrieving your basic profile information (name, email, profile picture)</li>
            </ul>
            <p className="mt-2">
              <strong>We do NOT:</strong>
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access your Gmail, emails, or messages</li>
              <li>Access your Google Drive files</li>
              <li>Access your Google Calendar</li>
              <li>Access any other Google services beyond basic profile information</li>
            </ul>
            <p className="mt-3">
              You can revoke our access to your Google account at any time through your 
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
                Google Account Permissions page
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Data Retention</h2>
            <p>
              We retain your information for as long as your account is active or as needed to provide services. 
              When you delete your account, we will delete your personal information within 30 days, except for:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Data required for legal or regulatory purposes</li>
              <li>Anonymized data used for analytics</li>
              <li>Backup copies (deleted within 90 days)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. International Data Transfers</h2>
            <p>
              Your data may be stored and processed in countries other than your own. We ensure appropriate 
              safeguards are in place to protect your information in compliance with applicable data protection laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Children&apos;s Privacy</h2>
            <p>
              Our service is not intended for children under 13 years of age. We do not knowingly collect 
              personal information from children. If you believe a child has provided us with personal information, 
              please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Changes to This Privacy Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of significant changes 
              by email or through a notice on our platform. The &quot;Last updated&quot; date at the top will reflect 
              the most recent version.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">13. Contact Us</h2>
            <p className="mb-2">
              If you have questions or concerns about this Privacy Policy or our data practices, please contact us:
            </p>
            <ul className="list-none space-y-2">
              <li><strong>Email:</strong> <a href="mailto:privacy@betsycrm.com" className="text-blue-600 hover:underline">privacy@betsycrm.com</a></li>
              <li><strong>Website:</strong> <a href="https://www.betsycrm.com" className="text-blue-600 hover:underline">www.betsycrm.com</a></li>
            </ul>
          </section>

          <section id="gdpr" className="border-t pt-6 mt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">GDPR Compliance (EU Users)</h2>
            <p>
              If you are located in the European Economic Area (EEA), you have additional rights under the 
              General Data Protection Regulation (GDPR):
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li><strong>Legal basis:</strong> We process your data based on contract performance and legitimate interests</li>
              <li><strong>Data controller:</strong> Betsy CRM is the data controller for your personal information</li>
              <li><strong>Right to lodge a complaint:</strong> You can file a complaint with your local data protection authority</li>
              <li><strong>Data portability:</strong> You can request your data in a structured, machine-readable format</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <a href="/dashboard" className="text-blue-600 hover:underline">
            ← Back to Home
          </a>
        </div>
      </div>

      <footer className="mt-8 text-center text-gray-500 text-sm">
        © {new Date().getFullYear()} Rafael Garcia Montoya. All rights reserved.
      </footer>
    </div>
  );
}
