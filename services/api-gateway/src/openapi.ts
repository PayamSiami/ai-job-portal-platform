// ------------------------------------------------------------
// OpenAPI 3.0 description of the public API surface exposed by the
// api-gateway. Built from the gateway routing table (see routes.ts) and
// the validated request shapes from each service's Zod schemas.
//
// Mounted on the gateway as static docs:
//   GET /api-docs          -> Swagger UI
//   GET /openapi.json       -> the spec (import into Postman/Insomnia/curl)
// ------------------------------------------------------------

// Helper builders keep the doc below compact and consistent. A typical
// endpoint returns one of two envelopes (see components.schemas):
//   sendSuccess -> { success:true, message, data? }
//   sendError   -> { success:false, message }
const Ok = (desc: string) => ({
  description: desc,
  content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" } } },
});
const Err = (desc: string) => ({
  description: desc,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});
const Body = (ref: string) => ({
  required: true,
  content: { "application/json": { schema: { $ref: ref } } },
});
const IntToken = { security: [{ internalToken: [] }] };

const PUBLIC = { security: [] };
const AUTH = { security: [{ bearerAuth: [] }] };

interface Operation {
  tags: string[];
  summary: string;
  security?: { bearerAuth: string[] }[];
  requestBody?: object;
  responses: Record<string, object>;
  description?: string;
  parameters?: object[];
}

function op(tag: string, summary: string, extra: Partial<Operation> = {}): Operation {
  return { tags: [tag], summary, responses: {}, ...extra };
}

export const openapiDocument: object = {
  openapi: "3.0.3",
  info: {
    title: "AI Job Portal API",
    version: "1.0.0",
    description:
      "Single entry point for the AI job-portal platform. All routes are served by the `api-gateway` " +
      "(http://localhost:8000). Unless noted, write endpoints enforce roles inside the owning service. " +
      "To use authed endpoints: sign in with `POST /api/auth/login`, copy the `accessToken`, then click the " +
      "**Authorize** lock-icon (top right) and paste `Bearer <token>` (persistAuthorization is on).",
  },
  servers: [{ url: "http://localhost:8000", description: "Local dev gateway" }],
  tags: [
    { name: "Auth", description: "Register, login, refresh, profile, admin roles" },
    { name: "Companies", description: "Company profiles, logos (slug/logo reads are public)" },
    { name: "Jobs", description: "Job listings (reads public, writes employer-only)" },
    { name: "Resumes", description: "Candidate resumes (owner-scoped)" },
    { name: "Applications", description: "Job applications (scoped to the candidate/employer)" },
    { name: "Interviews", description: "AI / employer-custom interviews (streaming supported)" },
    { name: "Notifications", description: "Unread notifications + activity feed for the user" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      internalToken: { type: "apiKey", in: "header", name: "x-internal-token", description: "Microservice↔microservice calls (INTERNAL_API_TOKEN)" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { success: { type: "boolean", example: false }, message: { type: "string" } },
      },
      SuccessEnvelope: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string" },
          data: {},
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          accessToken: { type: "string", description: "JWT for gateway auth" },
          refreshToken: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
        },
      },
      GoogleLoginRequest: {
        type: "object",
        required: ["idToken"],
        properties: {
          idToken: { type: "string", description: "Google ID token issued to the client after Google sign-in" },
        },
      },
      User: {
        type: "object",
        properties: {
          _id: { type: "string" },
          username: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["job-seeker", "employer", "admin"] },
          profile: { type: "object" },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["username", "email", "password", "role"],
        properties: {
          username: { type: "string", minLength: 3, maxLength: 30 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, description: "min 8: must include lower, upper, and a digit" },
          role: { type: "string", enum: ["job-seeker", "employer"] },
          profile: {
            type: "object",
            properties: {
              firstName: { type: "string", maxLength: 60 },
              lastName: { type: "string", maxLength: 60 },
              headline: { type: "string", maxLength: 120 },
              location: { type: "string", maxLength: 120 },
            },
          },
        },
      },
      ResumeRequest: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 2, maxLength: 120 },
          personalInfo: {
            type: "object",
            properties: {
              fullName: { type: "string", maxLength: 120 },
              email: { type: "string", format: "email" },
              phone: { type: "string", maxLength: 30 },
              location: { type: "string", maxLength: 120 },
            },
          },
          summary: { type: "string", maxLength: 2000 },
          skills: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 40 },
          workExperience: {
            type: "array",
            maxItems: 15,
            items: {
              type: "object",
              properties: {
                company: { type: "string", maxLength: 120 },
                position: { type: "string", maxLength: 120 },
                startDate: { type: "string", maxLength: 20 },
                endDate: { type: "string", maxLength: 20 },
                current: { type: "boolean" },
                description: { type: "string", maxLength: 2000 },
              },
            },
          },
          education: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                institution: { type: "string", maxLength: 120 },
                degree: { type: "string", maxLength: 120 },
                field: { type: "string", maxLength: 120 },
                startDate: { type: "string", maxLength: 20 },
                endDate: { type: "string", maxLength: 20 },
              },
            },
          },
          languages: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 10 },
          template: { type: "string", enum: ["modern", "classic", "minimal"], default: "modern" },
        },
      },
      Resume: {
        type: "object",
        properties: {
          _id: { type: "string" },
          userId: { type: "string" },
          title: { type: "string" },
          personalInfo: { type: "object" },
          summary: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
          workExperience: { type: "array", items: { type: "object" } },
          education: { type: "array", items: { type: "object" } },
          languages: { type: "array", items: { type: "string" } },
          template: { type: "string" },
          isPrimary: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      RefreshRequest: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string", minLength: 10 } } },
      StartInterviewRequest: {
        type: "object",
        required: ["applicationId"],
        properties: {
          applicationId: { type: "string", description: "Application _id the candidate is interviewing for" },
          language: { type: "string", enum: ["fa", "en"], default: "fa" },
          customQuestions: {
            type: "array",
            description: "Employer-supplied questions. When present, the interview is human-graded (mode 'custom'); AI is NOT invoked.",
            items: { type: "string", minLength: 3, maxLength: 300 },
            minItems: 1,
            maxItems: 20,
          },
        },
      },
      AnswerRequest: {
        type: "object",
        required: ["answer"],
        properties: { answer: { type: "string", minLength: 20, maxLength: 4000 } },
      },
      DiscAnswersRequest: {
        type: "object",
        required: ["responses"],
        properties: {
          responses: {
            type: "array",
            minItems: 24,
            maxItems: 24,
            items: {
              type: "object",
              required: ["index", "rating"],
              properties: {
                index: { type: "integer", minimum: 0, maximum: 23, description: "statement index, 0-23" },
                rating: { type: "integer", minimum: 1, maximum: 5, description: "1=Strongly disagree ... 5=Strongly agree" },
              },
            },
          },
        },
      },
      DiscScores: {
        type: "object",
        properties: {
          dominance: { type: "number", minimum: 0, maximum: 100 },
          influence: { type: "number", minimum: 0, maximum: 100 },
          steadiness: { type: "number", minimum: 0, maximum: 100 },
          conscientiousness: { type: "number", minimum: 0, maximum: 100 },
        },
      },
      DiscProfile: {
        type: "object",
        properties: {
          scores: { $ref: "#/components/schemas/DiscScores" },
          primary: { type: "string", enum: ["dominance", "influence", "steadiness", "conscientiousness"] },
          label: { type: "object", properties: { en: { type: "string" }, fa: { type: "string" } } },
          completedAt: { type: "string", format: "date-time" },
        },
      },
      InterviewQuestion: {
        type: "object",
        properties: { index: { type: "integer" }, type: { type: "string", enum: ["technical", "behavioral", "resume", "intro", "employer"] }, text: { type: "string" }, answered: { type: "boolean" } },
      },
      InterviewAnswer: {
        type: "object",
        properties: {
          questionIndex: { type: "integer" },
          answer: { type: "string" },
          score: { type: "number", nullable: true, description: "null when human-graded (custom mode)" },
          feedback: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          improvements: { type: "array", items: { type: "string" } },
          answeredAt: { type: "string", format: "date-time" },
        },
      },
      InterviewSession: {
        type: "object",
        properties: {
          _id: { type: "string" },
          applicationId: { type: "string" },
          jobId: { type: "string" },
          jobTitle: { type: "string" },
          candidateId: { type: "string" },
          employerId: { type: "string" },
          language: { type: "string", enum: ["fa", "en"] },
          mode: { type: "string", enum: ["ai", "custom"] },
          customQuestions: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["in_progress", "completed", "abandoned"] },
          questions: { type: "array", items: { $ref: "#/components/schemas/InterviewQuestion" } },
          answers: { type: "array", items: { $ref: "#/components/schemas/InterviewAnswer" } },
          disc: { nullable: true, allOf: [{ $ref: "#/components/schemas/DiscProfile" }] },
          overallScore: { type: "number", nullable: true },
          recommendation: { type: "string" },
          summary: { type: "string" },
          startedAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
    },
  },
  paths: {
    // ---------------------------------------------------------------- Auth
    "/api/auth/register": {
      post: {
        ...PUBLIC,
        ...op("Auth", "Register a new user", { requestBody: Body("#/components/schemas/RegisterRequest"), responses: { 201: Ok("User registered"), 400: Err("Validation error"), 409: Err("Username/email already exists") } }),
      },
    },
    "/api/auth/login": {
      post: {
        ...PUBLIC,
        ...op("Auth", "Sign in (returns JWT access + refresh tokens)", {
          requestBody: Body("#/components/schemas/LoginRequest"),
          responses: { 200: { description: "Tokens issued", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } }, 401: Err("Invalid email or password"), 429: Err("Rate limited") },
        }),
      },
    },
    "/api/auth/google": {
      post: {
        ...PUBLIC,
        ...op("Auth", "Google OAuth sign-in (exchanges a client-issued ID token for JWTs)", {
          requestBody: Body("#/components/schemas/GoogleLoginRequest"),
          responses: {
            200: { description: "Tokens issued", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } },
            401: Err("Invalid Google token"),
          },
        }),
      },
    },
    "/api/auth/refresh": {
      post: {
        ...PUBLIC,
        ...op("Auth", "Rotate an access token from a refresh token", { requestBody: Body("#/components/schemas/RefreshRequest"), responses: { 200: Ok("New access token"), 401: Err("Invalid refresh token") } }),
      },
    },
    "/api/auth/logout": { post: { ...AUTH, ...op("Auth", "Revoke current refresh-token family", { responses: { 200: Ok("Logged out"), 401: Err("Authentication required") } }) } },
    "/api/auth/me": { get: { ...AUTH, ...op("Auth", "Current user + profile", { responses: { 200: Ok("Profile"), 401: Err("Authentication required") } }) } },
    "/api/auth/change-password": { post: { ...AUTH, ...op("Auth", "Change password (current + new)", { responses: { 200: Ok("Password changed"), 401: Err("Authentication required"), 400: Err("Invalid current password") } }) } },
    "/api/auth/users/{id}/role": { patch: { ...AUTH, ...op("Auth", "Admin: change a user's role (job-seeker ↔ employer, admin not settable here)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Role updated"), 401: Err("Authentication required"), 403: Err("Admin only"), 400: Err("Cannot set role to admin") } }) } },

    // --------------------------------------------------------------- Companies
    "/api/companies": { put: { ...AUTH, ...op("Companies", "Create/update the authenticated employer's own company", { responses: { 200: Ok("Company upserted"), 401: Err("Authentication required"), 403: Err("Employer only") } }) } },
    "/api/companies/mine": { get: { ...AUTH, ...op("Companies", "Get the authenticated user's company", { responses: { 200: Ok("Company"), 401: Err("Authentication required") } }) } },
    "/api/companies/logo": { post: { ...AUTH, ...op("Companies", "Upload a (form-data) company logo", { requestBody: { content: { "multipart/form-data": { schema: { type: "object" } } } }, responses: { 200: Ok("Logo uploaded"), 401: Err("Authentication required") } }) } },
    "/api/companies/slug/{slug}": { get: { ...PUBLIC, ...op("Companies", "Public company lookup by slug", { parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Company"), 404: Err("Not found") } }) } },
    "/api/companies/logos/{filename}": {
      get: {
        ...PUBLIC,
        ...op("Companies", "Serve a company logo by filename", {
          parameters: [{ name: "filename", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Image bytes (image/*)" } },
        }),
      },
    },

    // --------------------------------------------------------------- Jobs
    "/api/jobs": {
      get: { ...PUBLIC, ...op("Jobs", "List jobs (paginated; filters via query string)", { responses: { 200: Ok("Job list") } }) },
      post: { ...AUTH, ...op("Jobs", "Create a job (employer)", { responses: { 201: Ok("Created"), 401: Err("Authentication required"), 403: Err("Employer only") } }) },
    },
    "/api/jobs/{id}": {
      get: { ...PUBLIC, ...op("Jobs", "Get a job by id", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Job"), 404: Err("Not found") } }) },
      put: { ...AUTH, ...op("Jobs", "Update a job (employer)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Updated"), 401: Err("Authentication required"), 403: Err("Employer only") } }) },
      delete: { ...AUTH, ...op("Jobs", "Delete a job (employer)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Deleted"), 401: Err("Authentication required"), 403: Err("Employer only") } }) },
    },
    "/api/jobs/slug/{slug}": { get: { ...PUBLIC, ...op("Jobs", "Get a job by slug", { parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Job"), 404: Err("Not found") } }) } },
    "/api/jobs/generate-description": { get: { ...AUTH, ...op("Jobs", "AI-assist: generate a job description from a title/requirements", { parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: { 200: Ok("Generated description"), 401: Err("Authentication required") } }) } },

    // ----------------------------------------------------------- Applications
    "/api/applications": {
      post: { ...AUTH, ...op("Applications", "Apply to a job (job-seeker)", { responses: { 201: Ok("Application created"), 401: Err("Authentication required"), 409: Err("Already applied") } }) },
    },
    "/api/applications/mine": { get: { ...AUTH, ...op("Applications", "List the candidate's applications", { responses: { 200: Ok("List") } }) } },
    "/api/applications/employer": { get: { ...AUTH, ...op("Applications", "List applications for the employer's jobs", { responses: { 200: Ok("List") } }) } },
    "/api/applications/stats": { get: { ...AUTH, ...op("Applications", "Employer application stats", { responses: { 200: Ok("Stats") } }) } },
    "/api/applications/{id}": { get: { ...AUTH, ...op("Applications", "Get an application (participant or admin)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Application"), 403: Err("Access denied"), 404: Err("Not found") } }) } },
    "/api/applications/{id}/status": { patch: { ...AUTH, ...op("Applications", "Employer: change application status (e.g. accepted/rejected)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Updated"), 403: Err("Employer only"), 400: Err("Invalid status") } }) } },
    "/api/applications/{id}/withdraw": { patch: { ...AUTH, ...op("Applications", "Candidate: withdraw an application", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Withdrawn"), 400: Err("Cannot withdraw now") } }) } },
    "/api/applications/job/{jobId}/candidates": { get: { ...AUTH, ...op("Applications", "Employer: list candidates who applied to one of your jobs (each item enriched with candidate.username + profile; PII such as email excluded)", { parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer", default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", default: 20 } }], responses: { 200: Ok("Paginated candidates"), 401: Err("Authentication required"), 404: Err("Job not found") } }) } },

    // --------------------------------------------------------------- Resumes
    "/api/resumes": { post: { ...AUTH, ...op("Resumes", "Create a resume (owner-scoped; max 10 per user)", { requestBody: Body("#/components/schemas/ResumeRequest"), responses: { 201: Ok("Resume created"), 400: Err("Validation error / resume limit reached"), 401: Err("Authentication required") } }) } },
    "/api/resumes/mine": { get: { ...AUTH, ...op("Resumes", "List the authenticated user's resumes", { responses: { 200: Ok("List"), 401: Err("Authentication required") } }) } },
    "/api/resumes/{id}": {
      get: { ...AUTH, ...op("Resumes", "Get a resume (owner or admin)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Resume"), 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) },
      put: { ...AUTH, ...op("Resumes", "Update a resume (owner; partial update supported)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: Body("#/components/schemas/ResumeRequest"), responses: { 200: Ok("Resume updated"), 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) },
      delete: { ...AUTH, ...op("Resumes", "Delete a resume (owner)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Resume deleted"), 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) },
    },
    "/api/resumes/{id}/primary": { patch: { ...AUTH, ...op("Resumes", "Set this resume as the user's primary resume", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Primary resume set"), 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) } },
    "/api/resumes/{id}/pdf": { get: { ...AUTH, ...op("Resumes", "Export a resume as PDF (owner or admin). Returns application/pdf bytes.", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "PDF bytes (application/pdf)", content: { "application/pdf": {} } }, 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) } },

    // ------------------------------------------------------------- Interviews
    "/api/interviews/start": {
      post: {
        ...AUTH,
        ...op("Interviews", "Start an interview", {
          description:
            "AI mode (default): the service generates a question set from the job + resume.\n" +
            "Custom mode: supply `customQuestions` (1-20 strings) — the employer's questions are used " +
            "verbatim, the interview is human-graded (answers are scored by the employer, not the AI), " +
            "and a DISC-style personality assessment is available afterwards.",
          requestBody: Body("#/components/schemas/StartInterviewRequest"),
          responses: {
            201: Ok("Interview started"),
            200: Ok("Interview already in progress (same session returned)"),
            400: Err("applicationId is required / validation error"),
            403: Err("Not your application"),
            404: Err("Application not found"),
            409: Err("Application already has a completed interview"),
            503: Err("AI question generation unavailable (AI mode only)"),
          },
        }),
      },
    },
    "/api/interviews/employer": { get: { ...AUTH, ...op("Interviews", "List interviews the authenticated employer supervises", { responses: { 200: Ok("List"), 401: Err("Authentication required"), 403: Err("Employer/admin only") } }) } },
    "/api/interviews/by-application/{applicationId}": { get: { ...AUTH, ...op("Interviews", "Find the interview for an application (participant)", { parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Session"), 403: Err("Access denied"), 404: Err("Not found") } }) } },
    "/api/interviews/{id}": {
      get: { ...AUTH, ...op("Interviews", "Interview session state (questions, answers, scores, mode, DISC summary)", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Session"), 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) },
    },
    "/api/interviews/{id}/answer": {
      post: {
        ...AUTH,
        ...op("Interviews", "Submit an answer (JSON). In 'custom' mode the answer is recorded without an AI score for employer evaluation.", {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: Body("#/components/schemas/AnswerRequest"),
          responses: { 200: Ok("Next question or final result"), 400: Err("All questions answered / invalid answer"), 401: Err("Authentication required"), 404: Err("Not found") },
        }),
      },
    },
    "/api/interviews/{id}/answer/stream": {
      post: {
        ...AUTH,
        ...op("Interviews", "Stream an answer (SSE, text/event-stream).", {
          description:
            "AI mode: live tokens (`{\"type\":\"token\",\"content\":\"...\"}`) then a final " +
            "`{\"type\":\"done\", ...scored answer, nextQuestion, finished}`. " +
            "Custom (human-graded) mode: a confirmation token + `done` (no AI score).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: Body("#/components/schemas/AnswerRequest"),
          responses: {
            200: {
              description: "Event stream of token/done frames",
              content: { "text/event-stream": { schema: { type: "string", description: "data: {...} per frame" } } },
            },
            400: Err("All questions answered / invalid answer"),
            401: Err("Authentication required"),
            404: Err("Not found"),
            503: Err("AI scoring unavailable (AI mode only)"),
          },
        }),
      },
    },
    "/api/interviews/{id}/abandon": { patch: { ...AUTH, ...op("Interviews", "Abandon an in-progress interview", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Abandoned"), 400: Err("Not active"), 401: Err("Authentication required") } }) } },
    "/api/interviews/{id}/disc/items": { get: { ...AUTH, ...op("Interviews", "The 24 personality statements (fa/en), for the candidate to rate", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Array of { index, factor, text }"), 401: Err("Authentication required"), 403: Err("Access denied"), 404: Err("Not found") } }) } },
    "/api/interviews/{id}/disc/answers": { post: { ...AUTH, ...op("Interviews", "Submit all 24 DISC ratings → server computes the profile", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: Body("#/components/schemas/DiscAnswersRequest"), responses: { 200: Ok("DiscProfile"), 400: Err("Validation error / each item rated once"), 401: Err("Authentication required"), 403: Err("Only available for custom interviews"), 404: Err("Not found") } }) } },
    "/api/interviews/{id}/disc": { get: { ...AUTH, ...op("Interviews", "Employer: view a candidate's personality profile", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("DiscProfile"), 401: Err("Authentication required"), 403: Err("Employer/admin only"), 404: Err("Profile not available") } }) } },
    "/api/interviews/{id}/report": { get: { ...AUTH, ...op("Interviews", "Employer: final transcript + hiring report", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Report"), 401: Err("Authentication required"), 403: Err("Employer/admin only"), 404: Err("Not found") } }) } },

    // ------------------------------------------------------- Notifications
    "/api/notifications": {
      get: { ...AUTH, ...op("Notifications", "List the authenticated user's notifications (unread-first)", { responses: { 200: Ok("List"), 401: Err("Authentication required") } }) },
    },
    "/api/notifications/activities": { get: { ...AUTH, ...op("Notifications", "List activity feed items", { responses: { 200: Ok("List"), 401: Err("Authentication required") } }) } },
    "/api/notifications/read-all": { post: { ...AUTH, ...op("Notifications", "Mark all notifications read", { responses: { 200: Ok("Updated"), 401: Err("Authentication required") } }) } },
    "/api/notifications/{id}/read": { patch: { ...AUTH, ...op("Notifications", "Mark a single notification read", { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: Ok("Updated"), 401: Err("Authentication required") } }) } },
  },
};

// Swagger UI served as a static page. It loads swagger-ui-dist@5 from a CDN
// (dev convenience — no extra dependency in node_modules) and points at the
// local /openapi.json endpoint. If offline, import /openapi.json into any
// OpenAPI tool instead.
export const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AI Job Portal API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{margin:0} #swagger-ui{height:100vh}</style></head><body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
<script>window.addEventListener('load',function(){SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset]})});</script>
</body></html>`;
