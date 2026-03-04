export class AppError extends Error {
	constructor(message, { statusCode = 500, code = "INTERNAL_ERROR", details = null, expose = false } = {}) {
		super(message);
		this.name = "AppError";
		this.statusCode = statusCode;
		this.code = code;
		this.details = details;
		this.expose = expose || statusCode < 500;
		Error.captureStackTrace?.(this, this.constructor);
	}
}

export function badRequest(message = "Bad request", details) {
	return new AppError(message, { statusCode: 400, code: "BAD_REQUEST", details, expose: true });
}

export function unauthorized(message = "Unauthorized", details) {
	return new AppError(message, { statusCode: 401, code: "UNAUTHORIZED", details, expose: true });
}

export function forbidden(message = "Forbidden", details) {
	return new AppError(message, { statusCode: 403, code: "FORBIDDEN", details, expose: true });
}

export function notFound(message = "Not found", details) {
	return new AppError(message, { statusCode: 404, code: "NOT_FOUND", details, expose: true });
}

export function conflict(message = "Conflict", details) {
	return new AppError(message, { statusCode: 409, code: "CONFLICT", details, expose: true });
}

export function unprocessable(message = "Unprocessable entity", details) {
	return new AppError(message, { statusCode: 422, code: "UNPROCESSABLE_ENTITY", details, expose: true });
}


