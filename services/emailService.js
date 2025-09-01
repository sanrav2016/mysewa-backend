import nodemailer from 'nodemailer';

// Email transporter configuration (same as in auth.js)
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

// Helper function to format date for display (convert UTC to EST/EDT)
const formatDate = (date) => {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York' // Automatically handles EST/EDT transitions
  });
};

// Event reminder email template
const createEventReminderEmail = (user, eventInstance, timeFrame) => {
  const sessionDetailUrl = `${process.env.FRONTEND_URL}/sessions/${eventInstance.id}`;
  
  return {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `Event Reminder: ${eventInstance.event.title} - ${timeFrame}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0;">MySewa</h1>
          <p style="margin: 5px 0 0 0;">Event Reminder</p>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            This is a friendly reminder about your upcoming session:
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
            <h3 style="color: #333; margin: 0 0 10px 0;">${eventInstance.event.title}</h3>
            <p style="color: #666; margin: 5px 0;"><strong>Date & Time:</strong> ${formatDate(eventInstance.startDate)}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Location:</strong> ${eventInstance.location || 'TBD'}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Duration:</strong> ${eventInstance.hours} hour${eventInstance.hours !== 1 ? 's' : ''}</p>
            <p style="color: #667eea; margin: 10px 0 0 0; font-weight: bold;">
              ⏰ Your session starts in ${timeFrame}
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${sessionDetailUrl}" 
               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block; 
                      font-weight: bold;">
              View Session Details
            </a>
          </div>
          
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            If you need to make any changes to your registration, please visit the session details page above.
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated reminder from MySewa. Please do not reply to this email.
          </p>
        </div>
      </div>
    `
  };
};

// Waitlist spot offer email template
const createWaitlistOfferEmail = (user, eventInstance) => {
  const sessionDetailUrl = `${process.env.FRONTEND_URL}/sessions/${eventInstance.id}`;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
  
  return {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `🎉 Waitlist Spot Available: ${eventInstance.event.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0;">MySewa</h1>
          <p style="margin: 5px 0 0 0;">Waitlist Spot Available!</p>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333; margin-bottom: 20px;">Congratulations ${user.name}!</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            A spot has opened up for you in the following session:
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h3 style="color: #333; margin: 0 0 10px 0;">${eventInstance.event.title}</h3>
            <p style="color: #666; margin: 5px 0;"><strong>Date & Time:</strong> ${formatDate(eventInstance.startDate)}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Location:</strong> ${eventInstance.location || 'TBD'}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Duration:</strong> ${eventInstance.hours} hours</p>
            <p style="color: #666; margin: 5px 0;"><strong>Description:</strong> ${eventInstance.description || eventInstance.event.description}</p>
          </div>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="color: #856404; margin: 0; font-weight: bold;">
              ⏰ IMPORTANT: You have until ${formatDate(expiresAt)} to accept or decline this spot.
            </p>
            <p style="color: #856404; margin: 5px 0 0 0; font-size: 14px;">
              After this time, the spot will be offered to the next person on the waitlist.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${sessionDetailUrl}" 
               style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block; 
                      font-weight: bold;">
              Accept or Decline Spot
            </a>
          </div>
          
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            Click the button above to go to the session details page where you can accept or decline this spot.
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated notification from MySewa. Please do not reply to this email.
          </p>
        </div>
      </div>
    `
  };
};

// Signup confirmation email template
const createSignupConfirmationEmail = (user, eventInstance, status) => {
  const sessionDetailUrl = `${process.env.FRONTEND_URL}/sessions/${eventInstance.id}`;
  const isWaitlist = status === 'WAITLIST';
  
  return {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `${isWaitlist ? '⏳' : '✅'} Signup Confirmation: ${eventInstance.event.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, ${isWaitlist ? '#ffc107 0%, #fd7e14 100%' : '#28a745 0%, #20c997 100%'}); padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0;">MySewa</h1>
          <p style="margin: 5px 0 0 0;">${isWaitlist ? 'Waitlist Confirmation' : 'Signup Confirmation'}</p>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            ${isWaitlist 
              ? 'You have been added to the waitlist for the following session:'
              : 'Your signup has been confirmed for the following session:'
            }
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${isWaitlist ? '#ffc107' : '#28a745'};">
            <h3 style="color: #333; margin: 0 0 10px 0;">${eventInstance.event.title}</h3>
            <p style="color: #666; margin: 5px 0;"><strong>Date & Time:</strong> ${formatDate(eventInstance.startDate)}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Location:</strong> ${eventInstance.location || 'TBD'}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Duration:</strong> ${eventInstance.hours} hours</p>
            <p style="color: #666; margin: 5px 0;"><strong>Description:</strong> ${eventInstance.description || eventInstance.event.description}</p>
            <p style="color: ${isWaitlist ? '#ffc107' : '#28a745'}; margin: 10px 0 0 0; font-weight: bold;">
              ${isWaitlist ? '⏳ Status: Waitlisted' : '✅ Status: Confirmed'}
            </p>
          </div>
          
          ${isWaitlist ? `
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="color: #856404; margin: 0; font-weight: bold;">
              ⏳ You are currently on the waitlist for this session.
            </p>
            <p style="color: #856404; margin: 5px 0 0 0; font-size: 14px;">
              If a spot becomes available, you will be automatically notified and have 12 hours to accept or decline.
            </p>
          </div>
          ` : ''}
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${sessionDetailUrl}" 
               style="background: linear-gradient(135deg, ${isWaitlist ? '#ffc107 0%, #fd7e14 100%' : '#28a745 0%, #20c997 100%'}); 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block; 
                      font-weight: bold;">
              View Session Details
            </a>
          </div>
          
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            You can view your session details and manage your registration using the button above.
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated confirmation from MySewa. Please do not reply to this email.
          </p>
        </div>
      </div>
    `
  };
};

// Send email with error logging
const sendEmail = async (mailOptions) => {
  try {
    const transporter = createTransporter();
    const result = await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${mailOptions.to}: ${mailOptions.subject}`);
    return result;
  } catch (error) {
    console.error(`Failed to send email to ${mailOptions.to}:`, error);
    // Log the error but don't retry as per requirements
    return null;
  }
};

// Send event reminder email
export const sendEventReminderEmail = async (user, eventInstance, timeFrame) => {
  const mailOptions = createEventReminderEmail(user, eventInstance, timeFrame);
  return await sendEmail(mailOptions);
};

// Send waitlist spot offer email
export const sendWaitlistOfferEmail = async (user, eventInstance) => {
  const mailOptions = createWaitlistOfferEmail(user, eventInstance);
  return await sendEmail(mailOptions);
};

// Send signup confirmation email
export const sendSignupConfirmationEmail = async (user, eventInstance, status) => {
  const mailOptions = createSignupConfirmationEmail(user, eventInstance, status);
  return await sendEmail(mailOptions);
};

// Session cancellation email template
const createSessionCancellationEmail = (user, eventInstance, reason) => {
  const sessionDetailUrl = `${process.env.FRONTEND_URL}/sessions/${eventInstance.id}`;
  
  return {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `❌ Session Cancelled: ${eventInstance.event.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0;">MySewa</h1>
          <p style="margin: 5px 0 0 0;">Session Cancelled</p>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            We regret to inform you that the following session has been cancelled:
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
            <h3 style="color: #333; margin: 0 0 10px 0;">${eventInstance.event.title}</h3>
            <p style="color: #666; margin: 5px 0;"><strong>Date & Time:</strong> ${formatDate(eventInstance.startDate)}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Location:</strong> ${eventInstance.location || 'TBD'}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Duration:</strong> ${eventInstance.hours} hour${eventInstance.hours !== 1 ? 's' : ''}</p>
            ${reason ? `<p style="color: #666; margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
            <p style="color: #dc3545; margin: 10px 0 0 0; font-weight: bold;">
              ❌ This session has been cancelled
            </p>
          </div>
          
          <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="color: #721c24; margin: 0; font-weight: bold;">
              ⚠️ Your registration for this session has been cancelled.
            </p>
            <p style="color: #721c24; margin: 5px 0 0 0; font-size: 14px;">
              Please check our calendar for other available sessions.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/events" 
               style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block; 
                      font-weight: bold;">
              Browse Other Sessions
            </a>
          </div>
          
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            We apologize for any inconvenience this may cause. If you have any questions, please contact our administrators.
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated notification from MySewa. Please do not reply to this email.
          </p>
        </div>
      </div>
    `
  };
};

// Session completion email template
const createSessionCompletionEmail = (user, eventInstance) => {
  const sessionDetailUrl = `${process.env.FRONTEND_URL}/sessions/${eventInstance.id}`;
  
  return {
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: `✅ Session Completed: ${eventInstance.event.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0;">MySewa</h1>
          <p style="margin: 5px 0 0 0;">Session Completed</p>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            The following session has been marked as completed:
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h3 style="color: #333; margin: 0 0 10px 0;">${eventInstance.event.title}</h3>
            <p style="color: #666; margin: 5px 0;"><strong>Date & Time:</strong> ${formatDate(eventInstance.startDate)}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Location:</strong> ${eventInstance.location || 'TBD'}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Duration:</strong> ${eventInstance.hours} hour${eventInstance.hours !== 1 ? 's' : ''}</p>
            <p style="color: #28a745; margin: 10px 0 0 0; font-weight: bold;">
              ✅ This session has been completed
            </p>
          </div>
          
          <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="color: #155724; margin: 0; font-weight: bold;">
              🎉 Thank you for participating in this session!
            </p>
            <p style="color: #155724; margin: 5px 0 0 0; font-size: 14px;">
              Your hours have been recorded and you can view your activity history in your dashboard.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/activity" 
               style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); 
                      color: white; 
                      padding: 12px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block; 
                      font-weight: bold;">
              View Activity History
            </a>
          </div>
          
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            We hope you enjoyed the session and look forward to seeing you at future events!
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated notification from MySewa. Please do not reply to this email.
          </p>
        </div>
      </div>
    `
  };
};

// Send session cancellation email
export const sendSessionCancellationEmail = async (user, eventInstance, reason) => {
  const mailOptions = createSessionCancellationEmail(user, eventInstance, reason);
  return await sendEmail(mailOptions);
};

// Send session completion email
export const sendSessionCompletionEmail = async (user, eventInstance) => {
  const mailOptions = createSessionCompletionEmail(user, eventInstance);
  return await sendEmail(mailOptions);
}; 