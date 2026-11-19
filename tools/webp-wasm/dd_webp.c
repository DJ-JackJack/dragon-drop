/*
 * The few functions Dragon Drop calls in libwebp (a WebP decoder, built to WebAssembly by build.sh). Everything else in the library is left out.
 * The caller allocates the input and the output inside the module, so the module never has to guess how big a picture will be.
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "src/webp/decode.h"

#define EXPORT(name) __attribute__((export_name(name)))

EXPORT("dd_alloc") void* dd_alloc(size_t n) { return malloc(n); }
EXPORT("dd_free") void dd_free(void* p) { free(p); }

/* Reads the header: out[0] = width, out[1] = height, out[2] = has alpha, out[3] = animated. Returns 1 if the bytes are a WebP file we can read the header of, else 0. */
EXPORT("dd_info") int dd_info(const uint8_t* data, size_t size, int* out) {
  WebPBitstreamFeatures f;
  if (WebPGetFeatures(data, size, &f) != VP8_STATUS_OK) return 0;
  out[0] = f.width;
  out[1] = f.height;
  out[2] = f.has_alpha;
  out[3] = f.has_animation;
  return 1;
}

/* Decodes into `out` (width * height * 4 bytes, straight RGBA). Returns 1 on success, 0 if the file is damaged, animated or otherwise not decodable. */
EXPORT("dd_decode") int dd_decode(const uint8_t* data, size_t size, uint8_t* out, size_t out_size, int stride) {
  return WebPDecodeRGBAInto(data, size, out, out_size, stride) != NULL;
}
