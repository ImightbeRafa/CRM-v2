import Link from 'next/link'
import { Shield, ArrowLeft } from 'lucide-react'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="bg-red-100 p-4 rounded-full">
            <Shield className="w-12 h-12 text-red-600" />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Access Denied
        </h1>
        
        <p className="text-gray-600 mb-6">
          You don&apos;t have permission to access this page. Please contact your administrator if you believe this is an error.
        </p>
        
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> Different user roles have access to different sections:
          </p>
          <ul className="text-sm text-yellow-700 mt-2 space-y-1">
            <li>• <strong>OWNER/ADMIN:</strong> Full access</li>
            <li>• <strong>MANAGER:</strong> Sales, Production, Statistics</li>
            <li>• <strong>SALES:</strong> Sales module only</li>
            <li>• <strong>PRODUCTION:</strong> Production module only</li>
            <li>• <strong>VIEWER:</strong> Read-only access</li>
          </ul>
        </div>
        
        <div className="flex flex-col gap-3">
          <Link 
            href="/home"
            className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go to Dashboard
          </Link>
          
          <Link 
            href="/auth/signin"
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            Sign in with a different account
          </Link>
        </div>
      </div>
    </div>
  )
}

