import { tags } from 'typia';

export interface AuthCredentialsRequest {
  email: string & tags.MinLength<1> & tags.MaxLength<254>;
  password: string & tags.MinLength<12> & tags.MaxLength<128>;
}

export interface AuthSessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    email: string;
    role: 'USER' | 'ADMIN';
  };
}
