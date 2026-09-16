// Stand-in for the Node builtins (`fs`, `path`, `url`, `module`, `node:module`) that `asc`'s and
// `binaryen`'s Node branches import.
//
// Those branches are guarded at runtime and never execute in a browser, but a bundler resolves them
// statically — so without this they fail the build for the browser target. Everything throws, so a
// mistake is loud rather than silent.

const unavailable = (name: string) => () => {
  throw new Error(
    `Node builtin "${name}" is not available in the browser build of the compiler.`,
  );
};

const names = [
  "access",
  "createRequire",
  "dirname",
  "existsSync",
  "fileURLToPath",
  "join",
  "mkdir",
  "open",
  "readFile",
  "readFileSync",
  "relative",
  "resolve",
  "sep",
  "statSync",
  "writeFile",
  "writeFileSync",
];

const stub: Record<string, unknown> = {};

for (const name of names) {
  stub[name] = unavailable(name);
}

stub.promises = stub;
stub.default = stub;

export default stub;
export const {
  access,
  createRequire,
  dirname,
  existsSync,
  fileURLToPath,
  join,
  mkdir,
  open,
  readFile,
  readFileSync,
  relative,
  resolve,
  sep,
  statSync,
  writeFile,
  writeFileSync,
  promises,
} = stub as Record<string, never>;
