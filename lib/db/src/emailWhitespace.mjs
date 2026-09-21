export const javascriptTrimWhitespaceCodePoints = Object.freeze([
  0x0009,
  0x000a,
  0x000b,
  0x000c,
  0x000d,
  0x0020,
  0x00a0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
]);

export const postgresJavaScriptTrimWhitespaceLiteral = `U&'${javascriptTrimWhitespaceCodePoints
  .map((codePoint) => `\\${codePoint.toString(16).toUpperCase().padStart(4, "0")}`)
  .join("")}'`;