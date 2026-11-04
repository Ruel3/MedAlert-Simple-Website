export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot connect to MedAlert. Check that the server is running.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.status, 'The server returned an invalid response.');
  }
  if (!response.ok) throw new ApiError(response.status, data.error || 'The request could not be completed.', data.fields);
  return data;
}
