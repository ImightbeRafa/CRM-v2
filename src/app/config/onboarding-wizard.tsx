'use client'

import { useState } from 'react'
import Link from 'next/link'

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])

  const steps = [
    {
      id: 1,
      title: "Welcome to Betsy CRM",
      description: "Let's set up your product configuration in a few simple steps.",
      icon: "👋"
    },
    {
      id: 2,
      title: "Product Fields",
      description: "Define what information you collect for each product (name, size, color, etc.)",
      icon: "📝"
    },
    {
      id: 3,
      title: "Option Sets",
      description: "Create dropdown menus for product options (colors, sizes, materials)",
      icon: "📋"
    },
    {
      id: 4,
      title: "Shipping Methods",
      description: "Set up your delivery options and pricing",
      icon: "🚚"
    },
    {
      id: 5,
      title: "Sellers",
      description: "Add your sales team members",
      icon: "👥"
    },
    {
      id: 6,
      title: "Complete!",
      description: "Your CRM is ready to use. Start creating sales!",
      icon: "🎉"
    }
  ]

  const handleStepComplete = (stepId: number) => {
    if (!completedSteps.includes(stepId)) {
      setCompletedSteps([...completedSteps, stepId])
    }
    if (stepId < steps.length) {
      setCurrentStep(stepId + 1)
    } else {
      onComplete()
    }
  }

  const currentStepData = steps.find(step => step.id === currentStep)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-600">
                Step {currentStep} of {steps.length}
              </span>
              <span className="text-sm text-gray-500">
                {Math.round((currentStep / steps.length) * 100)}% Complete
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(currentStep / steps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Step Content */}
          <div className="text-center mb-6">
            <div className="text-4xl mb-4">{currentStepData?.icon}</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {currentStepData?.title}
            </h2>
            <p className="text-gray-600">
              {currentStepData?.description}
            </p>
          </div>

          {/* Step-specific content */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-blue-800 mb-2">What you&apos;ll configure:</h3>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Product information fields</li>
                  <li>• Dropdown options for customization</li>
                  <li>• Shipping and delivery methods</li>
                  <li>• Sales team members</li>
                </ul>
              </div>
              <button
                onClick={() => handleStepComplete(1)}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-800 mb-2">Example Product Fields:</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-white p-2 rounded border">Product Name</div>
                  <div className="bg-white p-2 rounded border">Size</div>
                  <div className="bg-white p-2 rounded border">Color</div>
                  <div className="bg-white p-2 rounded border">Material</div>
                </div>
              </div>
              <button
                onClick={() => handleStepComplete(2)}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Continue to Product Fields
              </button>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-800 mb-2">Example Option Sets:</h3>
                <div className="space-y-2 text-sm">
                  <div className="bg-white p-2 rounded border">
                    <strong>Colors:</strong> Red, Blue, Green, Black
                  </div>
                  <div className="bg-white p-2 rounded border">
                    <strong>Sizes:</strong> Small, Medium, Large, XL
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleStepComplete(3)}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Continue to Option Sets
              </button>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-800 mb-2">Example Shipping Methods:</h3>
                <div className="space-y-2 text-sm">
                  <div className="bg-white p-2 rounded border">Standard Delivery - $5.00</div>
                  <div className="bg-white p-2 rounded border">Express Delivery - $15.00</div>
                  <div className="bg-white p-2 rounded border">Pickup - Free</div>
                </div>
              </div>
              <button
                onClick={() => handleStepComplete(4)}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Continue to Shipping
              </button>
            </div>
          )}

          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-800 mb-2">Add Your Sales Team:</h3>
                <div className="space-y-2 text-sm">
                  <div className="bg-white p-2 rounded border">John Smith - Sales Manager</div>
                  <div className="bg-white p-2 rounded border">Sarah Johnson - Sales Rep</div>
                </div>
              </div>
              <button
                onClick={() => handleStepComplete(5)}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Continue to Sellers
              </button>
            </div>
          )}

          {currentStep === 6 && (
            <div className="space-y-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="font-semibold text-green-800 mb-2">🎉 Setup Complete!</h3>
                <p className="text-green-700 text-sm">
                  Your CRM is now configured and ready to use. You can start creating sales and managing your business.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href="/ventas"
                  className="flex-1 bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition-colors text-center"
                >
                  Start Selling
                </Link>
                <button
                  onClick={onComplete}
                  className="flex-1 bg-gray-600 text-white py-3 px-4 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Manage Settings
                </button>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-6 pt-4 border-t">
            <button
              onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            <button
              onClick={onComplete}
              className="px-4 py-2 text-gray-500 hover:text-gray-700"
            >
              Skip Setup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
