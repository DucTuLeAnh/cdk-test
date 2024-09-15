
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { IHostedZone, PublicHostedZone } from 'aws-cdk-lib/aws-route53';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
export class DomainHost extends Construct {

    hostedZone: IHostedZone
    hostCertificate: ICertificate

    constructor(scope: Construct, id: string, recordTarget: route53.RecordTarget) {
        super(scope, id)

        const HOSTED_ZONE_ID: string = process.env.HOSTED_ZONE_ID ?? ""
        const ZONE_NAME: string = process.env.ZONE_NAME ?? ""


        this.hostedZone = PublicHostedZone.fromHostedZoneAttributes(
            this,
            id + '-' + 'HostedZone',
            { hostedZoneId: HOSTED_ZONE_ID, zoneName: ZONE_NAME }
        )

        // Request a certificate for your domain
        this.hostCertificate = new acm.Certificate(this, id + '-' + 'certificate', {
            domainName: ZONE_NAME,
            validation: acm.CertificateValidation.fromDns(this.hostedZone),
        });

        // Create an Alias record to point to the ALB
        new route53.ARecord(this, id + '-' + 'arecord', {
            zone: this.hostedZone,
            target: recordTarget,
            // If pointing to the root domain (example.com):
            recordName: '', // leave this empty
            // If pointing to a subdomain (www.example.com):
            // recordName: 'www',
        });
    }
}