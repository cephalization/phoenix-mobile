export type InstanceAuth =
  | { type: 'none' }
  | {
      type: 'oauth2';
      credentialKey: string;
    };

export type PhoenixInstance = {
  id: string;
  name: string;
  baseUrl: string;
  auth: InstanceAuth;
  createdAt: string;
};
