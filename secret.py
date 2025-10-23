import secrets
import base64

def generate_nextauth_secret(length=32):
    """
    Generate a secure random string for NEXTAUTH_SECRET.
    
    Args:
        length (int): Length of the random bytes before base64 encoding (default: 32)
    
    Returns:
        str: Base64-encoded secure random string
    """
    # Generate random bytes
    random_bytes = secrets.token_bytes(length)
    
    # Encode to base64 for a URL-safe string
    secret = base64.urlsafe_b64encode(random_bytes).decode('utf-8')
    
    # Remove padding ('=') to make it cleaner
    secret = secret.rstrip('=')
    
    return secret

if __name__ == "__main__":
    # Generate and print the secret
    nextauth_secret = generate_nextauth_secret()
    print("Generated NEXTAUTH_SECRET:", nextauth_secret)
    
   