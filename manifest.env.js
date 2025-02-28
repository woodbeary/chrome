// Environment variables for the extension
export const ENV = {
  // Extension password - this serves as a fallback when API validation is not available
  // For production, you should use a strong, unique password or ideally use API validation only
  EXTENSION_PASSWORD: "your_secure_password_here",

  // Optional: API endpoint for password validation
  // If this is configured, the extension will try this first before falling back to the password above
  API_VALIDATION_ENDPOINT: "https://chromefront.vercel.app/api/auth"
}; 