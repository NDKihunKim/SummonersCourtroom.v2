declare module "cloudflare:workers" {
  export const env: {
    analytic_engine?: {
      writeDataPoint: (dataPoint: {
        blobs?: string[];
        doubles?: number[];
        indexes?: string[];
      }) => void;
    };
  };
}
