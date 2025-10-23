export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Terms of Service</h1>
        
        <p className="text-sm text-gray-500 mb-6">
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>

        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Agreement to Terms</h2>
            <p>
              By accessing or using Betsy CRM (&quot;Service&quot;, &quot;Platform&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to be 
              bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, do not use our Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
            <p>
              Betsy CRM is a customer relationship management (CRM) platform that helps businesses:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Manage customer orders and sales</li>
              <li>Track inventory and products</li>
              <li>Generate invoices and shipping documents</li>
              <li>Monitor business performance and analytics</li>
              <li>Collaborate with team members</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Account Registration</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">3.1 Account Creation</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You must be at least 18 years old to create an account</li>
              <li>You must provide accurate and complete information</li>
              <li>You are responsible for maintaining the security of your account</li>
              <li>You may sign up using email/password or Google OAuth</li>
              <li>One account per person or organization</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">3.2 Account Security</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You are responsible for all activities under your account</li>
              <li>Keep your password secure and confidential</li>
              <li>Notify us immediately of any unauthorized access</li>
              <li>We are not liable for losses from unauthorized use of your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">4.1 You May:</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Use the Service for lawful business purposes</li>
              <li>Store and manage your business data</li>
              <li>Invite team members to your organization</li>
              <li>Export your data at any time</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">4.2 You May NOT:</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Violate any laws or regulations</li>
              <li>Infringe on intellectual property rights</li>
              <li>Upload malicious code, viruses, or harmful content</li>
              <li>Attempt to breach security or access unauthorized data</li>
              <li>Reverse engineer, decompile, or hack the Service</li>
              <li>Use the Service to spam or send unsolicited communications</li>
              <li>Share your account with others</li>
              <li>Resell or redistribute the Service without permission</li>
              <li>Store illegal, obscene, or inappropriate content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Ownership and Usage</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">5.1 Your Data</h3>
            <p className="mb-2">
              You retain all rights to the data you enter into the Service (&quot;Your Data&quot;):
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You own all customer information, orders, and business data</li>
              <li>You are responsible for the accuracy and legality of Your Data</li>
              <li>You grant us license to store, process, and display Your Data to provide the Service</li>
              <li>You can export or delete Your Data at any time</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">5.2 Our Rights</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>We own the Service, including all software, design, and trademarks</li>
              <li>We may use anonymized, aggregated data for analytics and improvements</li>
              <li>We reserve the right to display Your Data to your authorized team members</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Subscription and Payment</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">6.1 Plans and Pricing</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>We offer various subscription plans (Free, Basic, Pro, etc.)</li>
              <li>Pricing is displayed on our website and may change with notice</li>
              <li>Paid subscriptions are billed monthly or annually</li>
              <li>All prices are in the currency displayed at checkout</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">6.2 Payment Terms</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Payment is due at the start of each billing period</li>
              <li>We use third-party payment processors (e.g., Stripe)</li>
              <li>You authorize us to charge your payment method automatically</li>
              <li>Failed payments may result in service suspension</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">6.3 Refunds and Cancellation</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You may cancel your subscription at any time</li>
              <li>Cancellation takes effect at the end of the current billing period</li>
              <li>No refunds for partial months or unused time</li>
              <li>You can downgrade to the free plan instead of canceling</li>
              <li>Refunds may be provided at our sole discretion</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Service Availability</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>We strive for 99.9% uptime but do not guarantee uninterrupted service</li>
              <li>Scheduled maintenance will be announced in advance when possible</li>
              <li>We are not liable for downtime or service interruptions</li>
              <li>We may modify or discontinue features with notice</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Termination</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">8.1 By You</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You may cancel your account at any time through account settings</li>
              <li>You should export Your Data before canceling</li>
              <li>Your Data may be deleted 30 days after account cancellation</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">8.2 By Us</h3>
            <p className="mb-2">We may suspend or terminate your account if:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You violate these Terms</li>
              <li>You fail to pay for a paid subscription</li>
              <li>Your use harms other users or our systems</li>
              <li>Required by law or court order</li>
            </ul>
            <p className="mt-2">
              We will provide notice when possible and allow you to export Your Data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Intellectual Property</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>The Service, including code, design, and content, is our property</li>
              <li>&quot;Betsy CRM&quot; and our logo are trademarks</li>
              <li>You may not copy, modify, or distribute our software</li>
              <li>You grant us permission to use your company name as a reference client (unless you opt out)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Disclaimers and Limitations</h2>
            
            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">10.1 Disclaimer of Warranties</h3>
            <p className="mb-2">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>We do not guarantee accuracy, reliability, or fitness for a particular purpose</li>
              <li>We do not warrant that the Service will be error-free or secure</li>
              <li>Use of the Service is at your own risk</li>
            </ul>

            <h3 className="text-lg font-medium text-gray-900 mb-2 mt-4">10.2 Limitation of Liability</h3>
            <p className="mb-2">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>We are not liable for indirect, incidental, or consequential damages</li>
              <li>Our total liability is limited to the amount you paid us in the last 12 months</li>
              <li>We are not liable for data loss (you should maintain backups)</li>
              <li>We are not liable for third-party actions or services</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Indemnification</h2>
            <p>
              You agree to indemnify and hold us harmless from claims, damages, and expenses arising from:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Your violation of these Terms</li>
              <li>Your use of the Service</li>
              <li>Your Data or content you upload</li>
              <li>Your violation of any laws or third-party rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Privacy and Data Protection</h2>
            <p>
              Your use of the Service is also governed by our{' '}
              <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>.
              By using the Service, you consent to our collection and use of your information as described in the Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">13. Changes to Terms</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>We may modify these Terms at any time</li>
              <li>Significant changes will be notified via email or platform notice</li>
              <li>Continued use after changes constitutes acceptance</li>
              <li>If you disagree with changes, you should cancel your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">14. Governing Law and Disputes</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>These Terms are governed by the laws of [Your Jurisdiction]</li>
              <li>Disputes will be resolved in the courts of [Your Jurisdiction]</li>
              <li>You agree to first attempt to resolve disputes informally by contacting us</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">15. General Provisions</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Entire Agreement:</strong> These Terms constitute the entire agreement between you and us</li>
              <li><strong>Severability:</strong> If any provision is invalid, the rest remains in effect</li>
              <li><strong>No Waiver:</strong> Our failure to enforce a right does not waive that right</li>
              <li><strong>Assignment:</strong> You may not assign these Terms; we may assign to a successor</li>
              <li><strong>Force Majeure:</strong> We are not liable for delays due to events beyond our control</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">16. Contact Information</h2>
            <p className="mb-2">
              For questions about these Terms, please contact us:
            </p>
            <ul className="list-none space-y-2">
              <li><strong>Email:</strong> <a href="mailto:legal@betsycrm.com" className="text-blue-600 hover:underline">legal@betsycrm.com</a></li>
              <li><strong>Support:</strong> <a href="mailto:support@betsycrm.com" className="text-blue-600 hover:underline">support@betsycrm.com</a></li>
              <li><strong>Website:</strong> <a href="https://www.betsycrm.com" className="text-blue-600 hover:underline">www.betsycrm.com</a></li>
            </ul>
          </section>

          <section className="border-t pt-6 mt-8 bg-blue-50 p-4 rounded">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">By Using Betsy CRM, You Acknowledge:</h2>
            <ul className="list-disc pl-6 space-y-2 text-blue-800">
              <li>You have read and understood these Terms of Service</li>
              <li>You agree to be bound by these Terms</li>
              <li>You have read and understood our Privacy Policy</li>
              <li>You are authorized to accept these Terms on behalf of your organization</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <a href="/landing" className="text-blue-600 hover:underline">
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
