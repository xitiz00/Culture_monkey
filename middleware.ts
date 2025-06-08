import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  skipSuccessfulRequests: false,
}

function getRateLimitKey(request: NextRequest): string {
  // Use IP address for rate limiting
  const forwarded = request.headers.get("x-forwarded-for")
  const ip = forwarded ? forwarded.split(",")[0] : request.ip || "unknown"
  return `rate_limit:${ip}`
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetTime) {
    // Reset or create new record
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT.windowMs,
    })
    return false
  }

  if (record.count >= RATE_LIMIT.maxRequests) {
    return true
  }

  record.count++
  return false
}

export function middleware(request: NextRequest) {
  // Apply rate limiting to API routes
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const rateLimitKey = getRateLimitKey(request)

    if (isRateLimited(rateLimitKey)) {
      return NextResponse.json(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Maximum ${RATE_LIMIT.maxRequests} requests per minute.`,
          retryAfter: Math.ceil(RATE_LIMIT.windowMs / 1000),
        },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(RATE_LIMIT.windowMs / 1000).toString(),
            "X-RateLimit-Limit": RATE_LIMIT.maxRequests.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": new Date(Date.now() + RATE_LIMIT.windowMs).toISOString(),
          },
        },
      )
    }

    // Add rate limit headers to successful requests
    const record = rateLimitStore.get(rateLimitKey)
    if (record) {
      const response = NextResponse.next()
      response.headers.set("X-RateLimit-Limit", RATE_LIMIT.maxRequests.toString())
      response.headers.set("X-RateLimit-Remaining", (RATE_LIMIT.maxRequests - record.count).toString())
      response.headers.set("X-RateLimit-Reset", new Date(record.resetTime).toISOString())
      return response
    }
  }

  // Add security headers
  const response = NextResponse.next()

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("X-XSS-Protection", "1; mode=block")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

  // CORS headers for API routes
  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  }

  return response
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
}
