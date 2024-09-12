
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ApplicationProtocol, ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as elbActions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { PublicHostedZone } from 'aws-cdk-lib/aws-route53';

export class AppLoadBalancer extends Construct {

    frontendTargetGroup: ApplicationTargetGroup
    backendTargetGroup: ApplicationTargetGroup
    constructor(scope: Construct, id: string, vpc: ec2.Vpc) {
        super(scope, id)

        const HOSTED_ZONE_ID: string = process.env.HOSTED_ZONE_ID ?? ""
        const ZONE_NAME: string = process.env.ZONE_NAME ?? ""

        const userPool = new cognito.UserPool(this, 'MyUserPool', {
            userPoolName: 'MyAppUserPool',
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

        const userPoolClient = new cognito.UserPoolClient(this, 'MyUserPoolClient', {
            userPool,
            generateSecret: true,
            oAuth: {
                callbackUrls: ['https://' + ZONE_NAME, 'https://'+ZONE_NAME+'/oauth2/idpresponse'],  // Add your redirect URLs here
                //logoutUrls: ['https://.../'],  // Add your sign-out URLs here
                flows: {
                    authorizationCodeGrant: true,  // Enable the authorization code grant flow
                },
            },
        });

        const domain = new cognito.UserPoolDomain(this, 'CognitoDomain', {
            userPool,
            cognitoDomain: {
                domainPrefix: 'mytest-domain-34444',
            },
        });

        const hostedZone = PublicHostedZone.fromHostedZoneAttributes(
            this,
            'HostedZone',
            { hostedZoneId: HOSTED_ZONE_ID, zoneName: ZONE_NAME }
        )

        // Request a certificate for your domain
        const certificate = new acm.Certificate(this, 'Certificate', {
            domainName: ZONE_NAME,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });


        const ecsLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LB', {
            vpc: vpc,
            internetFacing: true
        });

        const ecsLBListener = ecsLoadBalancer.addListener('Listener', {
            port: 443,
            protocol: ApplicationProtocol.HTTPS,
            certificates: [certificate],
            open: true,
        });
        // Optional: Add a listener for HTTP traffic and redirect it to HTTPS
        const httpListener = ecsLoadBalancer.addListener('HttpListener', {
            port: 80,
            defaultAction: elbv2.ListenerAction.redirect({
                protocol: 'HTTPS',
                port: '443',
            }),
        });


        this.frontendTargetGroup = ecsLBListener.addTargets('ApplicationFleet', {
            port: 4200,
            protocol: ApplicationProtocol.HTTP,
            priority: 99,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/'])
            ]
        });


        this.backendTargetGroup = ecsLBListener.addTargets('ApplicationFleet2', {
            port: 5000,
            priority: 1,
            protocol: ApplicationProtocol.HTTP,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/read'])
            ]
        });


        ecsLBListener.addTargetGroups("Bla", { targetGroups: [this.backendTargetGroup] })

        // Create an Alias record to point to the ALB
        new route53.ARecord(this, 'AliasRecord', {
            zone: hostedZone,
            target: route53.RecordTarget.fromAlias(new LoadBalancerTarget(ecsLoadBalancer)),
            // If pointing to the root domain (example.com):
            recordName: '', // leave this empty
            // If pointing to a subdomain (www.example.com):
            // recordName: 'www',
        });

        ecsLBListener.addAction('CognitoAuth', {
            action: new elbActions.AuthenticateCognitoAction({
                userPool: userPool,
                userPoolClient: userPoolClient,
                userPoolDomain: domain,
                next: elbv2.ListenerAction.forward([this.frontendTargetGroup]),
            }),
            conditions: [elbv2.ListenerCondition.pathPatterns(['/'])],
            priority: 2,
        });

    }



}