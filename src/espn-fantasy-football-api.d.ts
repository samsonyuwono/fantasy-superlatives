// The espn-fantasy-football-api package ships no type declarations. We normalize its
// output into our own typed shapes in espn.ts, so an opaque module declaration is enough.
declare module 'espn-fantasy-football-api/node' {
  const value: unknown;
  export default value;
}
