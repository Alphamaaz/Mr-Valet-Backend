import { AppError } from "../errors/AppError.js";

export function errorHandler(err, req, res, next) {
	const isProd = (process.env.NODE_ENV || "development") === "production";

	// Normalize and map known DB errors first (e.g., duplicate key)
	let mappedError = err;
	const isMongoDuplicateKey = err?.code === 11000 || (err?.name === "MongoServerError" && err?.code === 11000);
	if (isMongoDuplicateKey) {
		const fields = Object.keys(err?.keyPattern || {});
		const fieldLabel = fields.length ? fields[0] : "resource";
		const message = `${fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1)} already exists`;
		mappedError = new AppError(message, {
			statusCode: 409,
			code: "DUPLICATE_KEY",
			details: { keyValue: err?.keyValue, keyPattern: err?.keyPattern }
		});
	}

	const normalizedError = mappedError instanceof AppError
		? mappedError
		: new AppError(mappedError?.message || "Internal server error", { statusCode: mappedError?.statusCode || 500, details: mappedError });

	// Log full error details to the server console for debugging/observability
	// Includes request context and stack
	const logPayload = {
		level: "error",
		method: req.method,
		url: req.originalUrl || req.url,
		statusCode: normalizedError.statusCode || 500,
		code: normalizedError.code,
		message: normalizedError.message,
		details: normalizedError.details,
		stack: normalizedError.stack,
	};
	// eslint-disable-next-line no-console
	console.error("[ErrorHandler]", JSON.stringify(logPayload, null, 2));

	// Always return a JSON response with message and code.
	// In development, include details and stack for easier debugging.
	const responseBody = {
		message: normalizedError.message,
		code: normalizedError.code,
	};
	if (!isProd && (normalizedError.details || normalizedError.stack)) {
		responseBody.details = normalizedError.details;
		responseBody.stack = normalizedError.stack;
	}

	res.status(normalizedError.statusCode || 500).json(responseBody);
}


