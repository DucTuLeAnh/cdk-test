
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { UserPool, UserPoolClient, UserPoolDomain } from 'aws-cdk-lib/aws-cognito';

export class CognitoAuth extends Construct {

    userPool: UserPool
    userPoolClient: UserPoolClient
    userPoolDomain: UserPoolDomain

    constructor(scope: Construct, id: string) {
        super(scope, id)

        const ZONE_NAME: string = process.env.ZONE_NAME ?? ""

        this.userPool = new cognito.UserPool(this, id + '-' + 'userpool', {
            userPoolName: id + '-' + 'userpool',
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireSymbols: true,
                requireUppercase: true,
            },
        });

        this.userPoolClient = new cognito.UserPoolClient(this, id + '-' +'userpoolclient', {
            userPool: this.userPool,
            generateSecret: true,
            oAuth: {
                callbackUrls: ['https://' + ZONE_NAME, 'https://'+ZONE_NAME+'/oauth2/idpresponse'],  // Add your redirect URLs here
                //logoutUrls: ['https://.../'],  // Add your sign-out URLs here
                flows: {
                    authorizationCodeGrant: true,  // Enable the authorization code grant flow
                },
            },
        });

        this.userPoolDomain = new cognito.UserPoolDomain(this, id + '-' + 'userpooldomain', {
            userPool: this.userPool,
            cognitoDomain: {
                domainPrefix: id + '-' + 'prefix',
            },
        });
    }

}
