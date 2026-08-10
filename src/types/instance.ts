export type InstanceAuth =
  | { type: 'none' }
  | {
      type: 'oauth2';
      allowInsecureTransport: boolean;
      authorizationEndpoint: string;
      clientId: string;
      credentialKey: string;
      issuer: string;
      registrationEndpoint?: string;
      revocationEndpoint: string;
      tokenEndpoint: string;
    };

export type PhoenixInstance = {
  id: string;
  name: string;
  baseUrl: string;
  auth: InstanceAuth;
  createdAt: string;
};
