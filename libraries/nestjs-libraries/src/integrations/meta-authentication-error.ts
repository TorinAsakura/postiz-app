type MetaErrorResponse = {
  error?: {
    code?: number | string;
    error_subcode?: number | string;
  };
};

export function isMetaMediaFetchError(response: string) {
  try {
    const { error } = JSON.parse(response) as MetaErrorResponse;
    const code = Number(error?.code);
    const subcode = Number(error?.error_subcode);

    return (
      (code === 324 && subcode === 2069019) ||
      (code === 9004 && subcode === 2207052)
    );
  } catch {
    return false;
  }
}
